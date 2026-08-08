import { jaJP_chat } from "./chat";
import { jaJP_researchAgentUi } from "./researchAgentUi";
import { jaJP_researchWorkbench } from "./researchWorkbench";

export const jaJP_researchAgentBundle = {
  ...jaJP_researchWorkbench,
  ...jaJP_researchAgentUi,
  ...jaJP_chat,
};
