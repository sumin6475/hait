// 프롬프트 소스의 단일 출처. `npm run prompts:compile` 이 여기서 스냅샷을 만든다.

import { unifiedInteractionPolicy } from "./common.unified-interaction-policy.js";
import { buildOnConversationPolicy } from "./common.build-on-conversation-policy.js";
import { taskEnvironment } from "./common.task-environment.js";
import { instructionPriority } from "./common.instruction-priority.js";
import { internalControlDiscipline } from "./common.internal-control-discipline.js";
import { outputDiscipline } from "./common.output-discipline.js";
import { behavioral as c1Behavioral } from "./c1.behavioral.js";
import { refinement as c1Refinement } from "./c1.refinement.js";
import { behavioral as c2Behavioral } from "./c2.behavioral.js";
import { refinement as c2Refinement } from "./c2.refinement.js";
import { behavioral as c3Behavioral } from "./c3.behavioral.js";
import { refinement as c3Refinement } from "./c3.refinement.js";
import { behavioral as c4Behavioral } from "./c4.behavioral.js";
import { refinement as c4Refinement } from "./c4.refinement.js";
import { routeContracts } from "./route-contracts.js";

export const SCHEMA_VERSION = 1;
export const VERSION = "1.12.0";

export const common = {
  unifiedInteractionPolicy,
  buildOnConversationPolicy,
  taskEnvironment,
  instructionPriority,
  internalControlDiscipline,
  outputDiscipline,
};

export const conditionRefinements: Record<string, string> = {
  C1: c1Refinement,
  C2: c2Refinement,
  C3: c3Refinement,
  C4: c4Refinement,
};

export const conditionBehavioral: Record<string, string> = {
  C1: c1Behavioral,
  C2: c2Behavioral,
  C3: c3Behavioral,
  C4: c4Behavioral,
};

export { routeContracts };
