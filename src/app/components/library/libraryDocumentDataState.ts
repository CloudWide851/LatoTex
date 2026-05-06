import type { DocumentDataState } from "./useLibraryDocumentData";

export function isDocumentDataStateEqual(current: DocumentDataState, next: DocumentDataState): boolean {
  return current.citation === next.citation
    && current.paperPreview === next.paperPreview
    && current.bibPreview === next.bibPreview
    && current.bibPreviewError === next.bibPreviewError
    && current.resolvedLink === next.resolvedLink
    && current.sourcePdfRelativePath === next.sourcePdfRelativePath
    && current.translatedPdfRelativePath === next.translatedPdfRelativePath
    && current.pdfCacheState === next.pdfCacheState
    && current.pdfCacheError === next.pdfCacheError
    && current.pdfDownloadedBytes === next.pdfDownloadedBytes
    && current.pdfTotalBytes === next.pdfTotalBytes;
}

export function hasPdfPreviewIdentityChanged(current: DocumentDataState, next: DocumentDataState): boolean {
  return current.sourcePdfRelativePath !== next.sourcePdfRelativePath
    || current.translatedPdfRelativePath !== next.translatedPdfRelativePath
    || current.pdfCacheState !== next.pdfCacheState
    || current.pdfCacheError !== next.pdfCacheError
    || current.pdfDownloadedBytes !== next.pdfDownloadedBytes
    || current.pdfTotalBytes !== next.pdfTotalBytes;
}
