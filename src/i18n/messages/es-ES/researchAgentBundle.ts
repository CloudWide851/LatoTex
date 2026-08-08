import { esES_chat } from "./chat";
import { esES_researchAgentUi } from "./researchAgentUi";
import { esES_researchWorkbench } from "./researchWorkbench";

export const esES_researchAgentBundle = {
  ...esES_researchWorkbench,
  ...esES_researchAgentUi,
  ...esES_chat,
};
