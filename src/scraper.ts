import { default as fetch, Headers } from "node-fetch";
import { traverse, extract } from "./fetch.js";
import { getLoginCookies } from "./browser.js";

type StepCommon = {
  executionStrategy: "fetch";
  includeCredentials: boolean;
};

type TraverseStep = {
  type: "traverse";
  itemSelector: string;
  nextPageSelector: string;
};

type ExtractStep = {
  type: "extract";
  itemSelector: string;
};

type ObtainStep = {
  type: "obtain";
  url: string;
};

type StepType = TraverseStep | ExtractStep | ObtainStep;

type StepDefinition = StepType & StepCommon;

type InteractiveCredentials = {
  type: "interactive";
  url: string;
};

type CredentialDefinition = InteractiveCredentials;

type JourneyDefinition = {
  credentials: CredentialDefinition;
  beginning: string[];
  steps: StepDefinition[];
};

const unknownStep = (step: never) => {
  console.error("Cannot execute unknown step:", step as unknown);
};

type RetrievalStrategy = (url: string) => Promise<{
  querySelector: (selector: string) => Promise<RetrievedNode>;
  querySelectorAll: (selector: string) => Promise<RetrievedNode[]>;
}>;

type RetrievedNode = {
  getAttr: (attrName: string) => string | undefined;
};

export const executeJourney = async (journey: JourneyDefinition) => {
  // TODO: executeJourney shouldn't know about how credentials are retrieved
  // or how to build the execution strategy
  const cookies = await getLoginCookies(journey.credentials.url);
  const headers = new Headers();
  headers.set("Cookie", cookies.map((c) => `${c.name}=${c.value}`).join("; "));
  const authenticatedFetch = (url: string) => fetch(url, { headers });

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
        break;
      default:
        unknownStep(step);
    }
  }
};
