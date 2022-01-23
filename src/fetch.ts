import { writeFile, stat } from "fs/promises";
import { join, basename } from "path";
import repl from "repl";

import { JSDOM } from "jsdom";
import type { Response } from "node-fetch";
import { extension } from "mime-types";
import mkdirp from "mkdirp";
import prettier from "prettier";
import { highlight } from "cli-highlight";
import xpath from "fontoxpath";
const { evaluateXPathToStrings, evaluateXPath } = xpath;

type FetchWrapper = (url: string) => Promise<Response>;

const resolveURL = (itemURL: string, baseURL: string) =>
  new URL(itemURL, baseURL).href;

export const traverse = async (
  doFetch: FetchWrapper,
  startURLs: string[],
  itemSelector: string,
  nextPageSelector: string
) => {
  let items: string[] = [];
  const frontier: string[] = startURLs;
  const seen: Set<string> = new Set();
  while (frontier.length > 0) {
    const nextURL = frontier.shift()!;
    console.info(nextURL);
    const page = await retryWithBackoff(
      () => doFetch(nextURL),
      (e) => console.warn("Failed to fetch", e)
    );
    const pageContent = await page!.text();
    const document = new JSDOM(pageContent).window.document;

    const selected = evaluateXPathToStrings(itemSelector, document);
    items.push(...selected.map((item) => resolveURL(item, nextURL)));

    const next = evaluateXPathToStrings(nextPageSelector, document);
    const nextURLs = next.map((item) => resolveURL(item, nextURL));
    for (const url of nextURLs) {
      if (!seen.has(url)) {
        seen.add(url);
        frontier.push(url);
      }
    }
  }

  return items;
};

export const extract = async (
  doFetch: FetchWrapper,
  itemURLs: string[],
  itemSelector: string
) => {
  let urls: string[] = [];
  for (const itemURL of itemURLs) {
    console.info(itemURL);
    try {
      const response = await retryWithBackoff(
        () => doFetch(itemURL),
        (e) => console.warn("Failed to fetch:", e)
      );
      const responseContent = await response!.text();
      const document = new JSDOM(responseContent).window.document;
      const selected = evaluateXPathToStrings(itemSelector, document);
      urls.push(...selected.map((item) => resolveURL(item, itemURL)));
    } catch (e) {
      console.error("Failed to fetch", e);
    }
  }

  return urls;
};

export const obtain = async (
  doFetch: FetchWrapper,
  targetDirectory: string,
  itemURLs: string[]
) => {
  await mkdirp(targetDirectory);

  for (const itemURL of itemURLs) {
    try {
      const response = await retryWithBackoff(
        () => doFetch(itemURL),
        (e) => console.warn("Failed to fetch:", e)
      );
      if (!response) {
        console.warn("Failed to fetch", itemURL);
        continue;
      }
      const content = await (await response.blob()).arrayBuffer();
      const fileName = basename(new URL(itemURL).pathname);

      let ext = "";
      if (fileName.indexOf(".") === -1) {
        const contentType = response.headers.get("Content-Type");
        if (contentType !== null) {
          ext = `.${extension(contentType)}`;
        }
      }

      const targetPath = join(targetDirectory, `${fileName}${ext}`);
      try {
        await stat(targetPath);
        console.warn("Refusing to overwrite", targetPath);
      } catch {
        await writeFile(targetPath, Buffer.from(content));
      }
    } catch (e) {
      console.warn("Failed to obtain:", e);
    }
  }

  return itemURLs;
};

const printElement = (element: HTMLElement) => {
  console.log(
    highlight(prettier.format(element.outerHTML.trim(), { parser: "html" }), {
      language: "html",
    })
  );
};

export const debug = async (doFetch: FetchWrapper, itemURLs: string[]) => {
  let currentURL = itemURLs.length > 0 ? itemURLs[0] : undefined;
  let document: Document | undefined = undefined;

  const replServer = repl.start({
    prompt: "> ",
    eval: (cmd, _, __, callback) => {
      if (cmd === "\n") {
        replServer.clearBufferedCommand();
        replServer.displayPrompt();
      } else if (!document) {
        replServer.clearBufferedCommand();
        console.log("No document loaded.");
        replServer.displayPrompt();
      } else {
        const result = evaluateXPath(cmd, document);
        const window = document.defaultView;
        if (window && result instanceof window.HTMLElement) {
          replServer.clearBufferedCommand();
          printElement(result);
          replServer.displayPrompt();
        } else if (
          window &&
          result instanceof Array &&
          result.length > 0 &&
          result[0] instanceof window.HTMLElement
        ) {
          replServer.clearBufferedCommand();
          console.log(`${result.length} results`);
          result.forEach((item: HTMLElement, i) => {
            console.log(`--- ${i} ---`);
            printElement(item);
          });
          replServer.displayPrompt();
        } else {
          callback(null, result);
        }
      }
    },
  });
  replServer.defineCommand("load", {
    help: "load the given URL",
    action: async (url) => {
      replServer.clearBufferedCommand();
      const response = await retryWithBackoff(
        () => doFetch(url),
        (e) => console.warn("Failed to fetch:", e)
      );
      const responseContent = await response!.text();
      document = new JSDOM(responseContent).window.document;
      currentURL = url;
      replServer.displayPrompt();
    },
  });
  replServer.defineCommand("current", {
    help: "show the current document URL",
    action: async () => {
      replServer.clearBufferedCommand();
      console.log(currentURL);
      replServer.displayPrompt();
    },
  });
  replServer.defineCommand("show", {
    help: "print the current document",
    action: async () => {
      replServer.clearBufferedCommand();
      if (!document) {
        console.warn("No document loaded.");
      } else {
        console.log(
          highlight(document?.documentElement.innerHTML, { language: "html" })
        );
      }
      replServer.displayPrompt();
    },
  });
  replServer.defineCommand("items", {
    help: "list the current items",
    action: async () => {
      replServer.clearBufferedCommand();
      console.log(itemURLs);
      replServer.displayPrompt();
    },
  });
  await new Promise((res) => replServer.on("exit", res));
};

interface RetryConfig {
  initialDelayMS: number;
  maxRetries: number;
  backoffFactor: number;
}

const defaultRetryConfig: RetryConfig = {
  initialDelayMS: 1000,
  maxRetries: -1,
  backoffFactor: 2,
};

const sleep = (timeMS: number) => {
  return new Promise((res) => setTimeout(res, timeMS));
};

const retryWithBackoff = async <TReturnValue>(
  execute: () => Promise<TReturnValue>,
  onFailure?: (e: unknown) => void,
  config: RetryConfig = defaultRetryConfig
) => {
  let retryDelay = config.initialDelayMS;
  let numRetries = 0;
  while (config.maxRetries === -1 || numRetries < config.maxRetries) {
    try {
      const returnValue = await execute();
      return returnValue;
    } catch (e) {
      if (onFailure) {
        onFailure(e);
      }
      await sleep(retryDelay);
      retryDelay *= config.backoffFactor;
      numRetries += 1;
    }
  }
  return undefined;
};
