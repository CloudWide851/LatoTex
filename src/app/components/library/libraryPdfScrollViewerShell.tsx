import type { ComponentPropsWithoutRef, MouseEvent as ReactMouseEvent, ReactNode, WheelEvent as ReactWheelEvent } from "react";

type LibraryPdfViewerRootPropsArgs = {
  lensEnabled: boolean;
  lensActive: boolean;
  containerClassName: string;
  readOnly: boolean;
  onRequestToolConfig?: () => void;
  onWheelCapture: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
};

export function buildLibraryPdfViewerRootProps(args: LibraryPdfViewerRootPropsArgs) {
  const {
    lensEnabled,
    lensActive,
    containerClassName,
    readOnly,
    onRequestToolConfig,
    onWheelCapture,
    onWheel,
  } = args;

  return {
    className: `${containerClassName}${lensEnabled && lensActive ? " cursor-zoom-out" : ""}`,
    tabIndex: 0,
    "data-library-pdf-scroll": "true",
    style: {
      touchAction: "pan-x pan-y" as const,
      overscrollBehavior: "contain" as const,
    },
    onWheelCapture,
    onWheel,
    onContextMenu:
      readOnly || !onRequestToolConfig
        ? undefined
        : (event: ReactMouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          onRequestToolConfig();
    },
  } as ComponentPropsWithoutRef<"div"> & { "data-library-pdf-scroll": string };
}

export function LibraryPdfViewerErrorState(props: {
  rootProps: ComponentPropsWithoutRef<"div">;
  children: ReactNode;
}) {
  const { rootProps, children } = props;
  return <div {...rootProps}>{children}</div>;
}
