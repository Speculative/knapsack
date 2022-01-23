import { argv } from "process";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { readFile } from "fs/promises";
import { default as fetch, Headers } from "node-fetch";
import { traverse, extract, obtain, debug } from "./fetch.js";
import { getLoginCookies } from "./browser.js";
import { Static, ValidationError } from "runtypes";
import { JourneyDefinition } from "./journey.js";

const cmd = yargs(hideBin(argv))
  .command(
    "run",
    "Go on a journey",
    (yargs) => {
      return yargs.option("journeyPath", {
        alias: "j",
        describe: "journey definition path",
        default: "./knapsack.json",
      });
    },
    async (args) => {
      try {
        const journeyContent = await readFile(args.journeyPath);
        const maybeJourney = JSON.parse(journeyContent.toString());
        const journey = JourneyDefinition.check(maybeJourney);
        console.log(journey);
        await executeJourney(journey);
      } catch (e) {
        if (e instanceof Error && (e as any).code === "ENOENT") {
          console.error(`Can't find ${args.journeyPath}`);
        } else if (e instanceof ValidationError) {
          console.error("Malformatted journey definition:", e.message);
        } else {
          console.error("Unknown error:", e);
        }
      }
    }
  )
  .help()
  .showHelpOnFail(true)
  .demandCommand()
  .parse();

const unknownStep = (step: never) => {
  console.error("Cannot execute unknown step:", step as unknown);
};

export const executeJourney = async (
  journey: Static<typeof JourneyDefinition>
) => {
  // TODO: executeJourney shouldn't know about how credentials are retrieved
  // or how to build the execution strategy
  let authenticatedFetch: (url: string) => ReturnType<typeof fetch> = fetch;
  if (journey.credentials) {
    const cookies = await getLoginCookies(journey.credentials.url);
    const headers = new Headers();
    headers.set(
      "Cookie",
      cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    );
    authenticatedFetch = (url: string) => fetch(url, { headers });
  }

  let currentResult: string[] = journey.beginning;

  for (const step of journey.steps) {
    console.info(`[${step.type}] on ${currentResult.length} items`);
    // TODO: should be using the execution strategy resolver
    const fetchExecutor = step.includeCredentials ? authenticatedFetch : fetch;
    switch (step.type) {
      case "traverse":
        currentResult = await traverse(
          fetchExecutor,
          currentResult,
          step.itemSelector,
          step.nextPageSelector
        );
        break;
      case "extract":
        currentResult = await extract(
          fetchExecutor,
          currentResult,
          step.itemSelector
        );
        break;
      case "obtain":
        currentResult = await obtain(
          fetchExecutor,
          step.targetDirectory,
          currentResult
        );
        break;
      case "debug":
        await debug(fetchExecutor, currentResult);
      case "record":
        break;
      default:
        unknownStep(step);
    }
  }
};
