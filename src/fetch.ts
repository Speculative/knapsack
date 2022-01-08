import { JSDOM } from "jsdom";
import type { Response } from "node-fetch";
import xpath from "fontoxpath";
const { evaluateXPathToStrings } = xpath;

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
  let frontier: string[] = startURLs;
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
    items.push(...selected);

    const next = evaluateXPathToStrings(nextPageSelector, document);
    frontier.push(...next.map((item) => resolveURL(item, nextURL)));
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
