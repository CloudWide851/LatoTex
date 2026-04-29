import type { FsAction, FsScope } from "../../../shared/types/app";

export type WorkspaceFsEventDetail = {
  scope: FsScope;
  action: FsAction;
  path: string;
  targetPath?: string;
};

export const EMPTY_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="default" name="Page-1">
    <mxGraphModel dx="1240" dy="720" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1920" pageHeight="1080" background="#ffffff" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
