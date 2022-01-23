import {
  Boolean,
  String,
  Record,
  Intersect,
  Union,
  Literal,
  Dictionary,
  Array,
  Optional,
  Static,
} from "runtypes";

const StepCommon = Record({
  executionStrategy: Literal("fetch"),
  includeCredentials: Optional(Boolean),
});

const TraverseStep = Record({
  type: Literal("traverse"),
  itemSelector: String,
  nextPageSelector: String,
});

const ExtractStep = Record({
  type: Literal("extract"),
  itemSelector: String,
});

const ObtainStep = Record({
  type: Literal("obtain"),
  targetDirectory: String,
});

const RecordStep = Record({
  type: Literal("record"),
  fieldSelectors: Dictionary(String),
});

const DebugStep = Record({
  type: Literal("debug"),
});

const StepType = Union(
  TraverseStep,
  ExtractStep,
  ObtainStep,
  RecordStep,
  DebugStep
);

const StepDefinition = Intersect(StepType, StepCommon);

const InteractiveCredentials = Record({
  type: Literal("interactive"),
  url: String,
});

const CredentialDefinition = InteractiveCredentials;

export const JourneyDefinition = Record({
  credentials: Optional(CredentialDefinition),
  beginning: Array(String),
  steps: Array(StepDefinition),
});
