import type {
  KnowledgeFetchResponse,
  KnowledgeItem,
  KnowledgeSearchHit,
} from "../../../shared/types/app";

export function itemFromHit(hit: KnowledgeSearchHit): KnowledgeItem {
  return {
    itemId: hit.itemId,
    projectId: hit.projectId,
    relativePath: hit.relativePath,
    title: hit.title,
    sourceKind: hit.sourceKind,
    contentHash: "",
    indexState: "ready",
    chunkCount: 0,
    locked: true,
    updatedAt: "",
  };
}

export function HighlightedText(props: { text: string; query: string }) {
  const query = props.query.trim();
  if (!query) {
    return <>{props.text}</>;
  }
  const lower = props.text.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) {
    return <>{props.text}</>;
  }
  return (
    <>
      {props.text.slice(0, index)}
      <mark className="rounded-sm bg-amber-100 px-0.5 text-inherit">
        {props.text.slice(index, index + query.length)}
      </mark>
      {props.text.slice(index + query.length)}
    </>
  );
}

export function anchorLabel(
  hit: KnowledgeSearchHit | KnowledgeFetchResponse | null,
) {
  const anchor = hit?.citation.anchor;
  if (!anchor) {
    return "";
  }
  if (anchor.page) {
    return `p.${anchor.page}`;
  }
  if (anchor.lineStart) {
    return anchor.lineEnd && anchor.lineEnd !== anchor.lineStart
      ? `L${anchor.lineStart}–${anchor.lineEnd}`
      : `L${anchor.lineStart}`;
  }
  return anchor.heading || anchor.value;
}
