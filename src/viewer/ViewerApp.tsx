import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  backgroundColor,
  border,
  colors,
  Drawer,
  flex,
  flexItem,
  H1,
  P,
  proseHtml,
  proseMaxWidth,
  spacing,
  text,
} from "maui";
import { style, useStyles } from "purse-styles";
import type { ViewerDocument } from "../parseViewer.js";
import { targetQuote } from "../comments/types.js";
import { ComarkView } from "./ComarkView.tsx";
import { SourceDiffPanel, type SourceSelection } from "./SourceDiffPanel.js";
import { CloseServerButton } from "./CloseServerButton.tsx";
import { DiffButton } from "./DiffButton.tsx";
import { TocButton } from "./TocButton.tsx";
import {
  hasTableOfContents,
  TableOfContents,
  TOC_OVERLAY_MIN_WIDTH_PX,
} from "./TableOfContents.tsx";
import { CommentsButton } from "./comments/CommentsButton.tsx";
import { CommentsPanel, type CommentDraft } from "./comments/CommentsPanel.tsx";
import {
  SelectionPopover,
  type SelectionAnchor,
} from "./comments/SelectionPopover.tsx";
import { selectionTarget, useComments } from "./comments/useComments.js";
import { useMediaQuery } from "./useMediaQuery.ts";
import { ViewerModeContext, type ViewerMode } from "./viewerMode.ts";

type ViewerMeta = {
  title: string;
};

export function ViewerApp(props: {
  document: ViewerDocument;
  mode: ViewerMode;
  title?: string;
  headerActions?: ReactNode;
}) {
  const viewerDocument = props.document;
  const meta = useViewerMeta(props.mode === "local");
  const [selection, setSelection] = useState<SourceSelection>();
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const hasSourceDiffs =
    viewerDocument.sourceDiffs.length > 0 || viewerDocument.hasReferences;
  const diffPanelOpen = hasSourceDiffs && showDiffPanel;
  const body = useStyles(styles.body);
  const [shutDown, setShutDown] = useState(false);
  const parsedTitle =
    props.title ??
    viewerDocument.headings.find((heading) => heading.level === 1)?.text ??
    "diffmap";
  const title =
    props.mode === "local" && meta !== undefined ? meta.title : parsedTitle;
  const shell = useStyles(styles.shell);
  const header = useStyles(styles.header);
  const heading = useStyles(styles.heading);
  const titleClass = useStyles(styles.title);
  const actions = useStyles(styles.actions);
  const article = useStyles(styles.article);
  const prose = useStyles(styles.prose);
  const content = useStyles(proseHtml("md"), styles.content);
  const closed = useStyles(styles.closed);
  const closedCopy = useStyles(styles.closedCopy);
  const stage = useStyles(styles.stage);
  const articleRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dwellTimer = useRef<number>(undefined);
  const hasToc = hasTableOfContents(viewerDocument.headings);
  const tocFits = useMediaQuery(
    `(min-width: ${String(TOC_OVERLAY_MIN_WIDTH_PX)}px)`,
  );
  const [overlayOpen, setOverlayOpen] = useState(true);
  const [floating, setFloating] = useState<"click" | "dwell">();
  const tocExpanded = tocFits ? overlayOpen : floating !== undefined;
  const suppressTocReopen = useRef(false);
  const commentsEnabled = props.mode === "local";
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [draft, setDraft] = useState<CommentDraft>();
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor>();
  const [pendingSelection, setPendingSelection] = useState<CommentDraft>();
  const openCommentThread = useCallback((threadId: string) => {
    setDraft(undefined);
    setSelectionAnchor(undefined);
    setPendingSelection(undefined);
    setActiveThreadId(threadId);
    setCommentsOpen(true);
  }, []);
  const comments = useComments({
    enabled: commentsEnabled,
    containerRef: contentRef,
    activeThreadId,
    onActivate: openCommentThread,
  });
  const openComments = comments.threads.filter(
    (entry) => entry.thread.status === "open",
  ).length;
  const commentsPanelOpen = commentsEnabled && commentsOpen;

  const dismissFloatingToc = useCallback(() => {
    // Maui springs the panel closed only if Dismiss/Escape/scrim run while
    // isOpen is still true. Setting isOpen false here unmounts and snaps.
    const drawer = document.querySelector("[data-side='start']");
    const dismiss = drawer?.querySelector("button[tabindex='-1']");
    if (dismiss instanceof HTMLButtonElement) {
      dismiss.click();
      return;
    }
    setFloating(undefined);
  }, []);

  useEffect(() => {
    document.title = title;
  }, [title]);

  // A selection inside the prose offers a Comment button anchored to it.
  useEffect(() => {
    if (!commentsEnabled) return;
    const update = () => {
      const domSelection = window.getSelection();
      const contentEl = contentRef.current;
      const range =
        domSelection === null ||
        domSelection.isCollapsed ||
        domSelection.rangeCount === 0
          ? undefined
          : domSelection.getRangeAt(0);
      // Any selection that touches the prose counts, including select-all.
      const target =
        range === undefined ||
        contentEl === null ||
        !range.intersectsNode(contentEl)
          ? undefined
          : selectionTarget(comments.blocks, range);
      // An unanchored quote must not pick up text from outside the prose.
      if (
        range === undefined ||
        target === undefined ||
        (target.kind === "document" &&
          contentEl?.contains(range.commonAncestorContainer) !== true)
      ) {
        setSelectionAnchor(undefined);
        setPendingSelection(undefined);
        return;
      }
      const rect = range.getBoundingClientRect();
      setPendingSelection({ target, quote: targetQuote(target) });
      // Keep the popover on screen when the selection hugs an edge.
      setSelectionAnchor({
        left: clamp(rect.left + rect.width / 2, 80, window.innerWidth - 80),
        top: clamp(rect.top - 8, 56, window.innerHeight - 8),
      });
    };
    // Capture phase: react-aria tables stop pointerup from bubbling.
    document.addEventListener("pointerup", update, true);
    document.addEventListener("keyup", update, true);
    return () => {
      document.removeEventListener("pointerup", update, true);
      document.removeEventListener("keyup", update, true);
    };
  }, [commentsEnabled, comments.blocks]);

  useEffect(() => {
    return () => window.clearTimeout(dwellTimer.current);
  }, []);

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (id === "") return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const onButton = target.closest("#diffmap-toc-button") !== null;
      if (onButton && floating !== undefined) {
        // Capture before Maui's dismissable overlay sees the same pointerdown
        // and clears `floating`; the later click must not reopen.
        suppressTocReopen.current = true;
      }
      if (floating !== "dwell") return;
      if (onButton) return;
      const onPanel =
        target.closest("#diffmap-toc") !== null ||
        target.closest("[data-side='start']") !== null;
      if (onPanel) setFloating("click");
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    const onPointerUp = () => {
      window.setTimeout(() => {
        suppressTocReopen.current = false;
      }, 0);
    };
    window.addEventListener("pointerup", onPointerUp, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
    };
  }, [floating]);

  useEffect(() => {
    if (!hasToc || tocFits) {
      window.clearTimeout(dwellTimer.current);
      dwellTimer.current = undefined;
      return;
    }
    const onMove = (event: MouseEvent) => {
      const stageEl = stageRef.current;
      if (stageEl === null) return;
      const bounds = stageEl.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const inStage =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      if (floating === "dwell") {
        const panelRight =
          document.querySelector("[data-side='start']")?.getBoundingClientRect()
            .right ??
          document.getElementById("diffmap-toc")?.getBoundingClientRect().right;
        if (
          panelRight !== undefined &&
          event.clientX > panelRight + DWELL_LEAVE_PAD_PX
        ) {
          dismissFloatingToc();
        }
        return;
      }
      if (floating !== undefined) return;
      if (inStage && x <= TOC_DWELL_EDGE_PX) {
        if (dwellTimer.current !== undefined) return;
        dwellTimer.current = window.setTimeout(() => {
          dwellTimer.current = undefined;
          setFloating("dwell");
        }, DWELL_MS);
        return;
      }
      if (x <= TOC_DWELL_CANCEL_PX && inStage) return;
      window.clearTimeout(dwellTimer.current);
      dwellTimer.current = undefined;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("mousemove", onMove);
      window.clearTimeout(dwellTimer.current);
      dwellTimer.current = undefined;
    };
  }, [dismissFloatingToc, floating, hasToc, tocFits]);

  if (shutDown) {
    return (
      <main className={closed}>
        <div className={closedCopy}>
          <H1>Closed spec</H1>
          <P>The local server stopped.</P>
        </div>
      </main>
    );
  }

  return (
    <ViewerModeContext.Provider value={props.mode}>
      <div className={shell}>
        <header className={header}>
          <div className={heading}>
            {hasToc && (
              <TocButton
                expanded={tocExpanded}
                onClick={() => {
                  if (tocFits) {
                    setOverlayOpen((open) => !open);
                    return;
                  }
                  if (suppressTocReopen.current) {
                    suppressTocReopen.current = false;
                    if (floating !== undefined) dismissFloatingToc();
                    return;
                  }
                  if (floating !== undefined) {
                    dismissFloatingToc();
                    return;
                  }
                  setFloating("click");
                }}
              />
            )}
            <div className={titleClass}>{title}</div>
          </div>
          <div className={actions}>
            {hasSourceDiffs && (
              <DiffButton
                pressed={showDiffPanel}
                onClick={() => setShowDiffPanel((open) => !open)}
              />
            )}
            {commentsEnabled && (
              <CommentsButton
                pressed={commentsPanelOpen}
                openCount={openComments}
                onClick={() => setCommentsOpen((open) => !open)}
              />
            )}
            {props.headerActions}
            {props.mode === "local" && (
              <CloseServerButton
                onClick={() => {
                  setShutDown(true);
                  // oxlint-disable-next-line typescript/no-floating-promises -- React click callbacks cannot await the server shutdown request.
                  void closeViewer();
                }}
              />
            )}
          </div>
        </header>
        <div ref={stageRef} className={stage}>
          {hasToc && !tocFits && (
            <Drawer
              isOpen={floating !== undefined}
              onOpenChange={(open) => {
                if (!open) setFloating(undefined);
              }}
              side="start"
              aria-label="Table of contents"
            >
              <TableOfContents
                headings={viewerDocument.headings}
                articleRef={articleRef}
                layout="panel"
                onNavigate={dismissFloatingToc}
              />
            </Drawer>
          )}
          <div
            className={body}
            data-has-source-diffs={diffPanelOpen}
            data-has-comments={commentsPanelOpen}
          >
            <article ref={articleRef} className={article}>
              <div className={prose}>
                <div
                  ref={contentRef}
                  className={content}
                  data-diffmap-kind="page"
                >
                  <ComarkView
                    document={viewerDocument}
                    selectedAnnotation={selection?.annotation}
                    onSelectAnnotation={(line) => {
                      setShowDiffPanel(true);
                      setSelection({
                        annotation: line,
                        reference: line.references[0]!,
                      });
                    }}
                  />
                </div>
              </div>
            </article>
            {diffPanelOpen && (
              <SourceDiffPanel
                items={viewerDocument.sourceDiffs}
                selection={selection}
                onSelect={setSelection}
              />
            )}
            {commentsPanelOpen && (
              <CommentsPanel
                comments={comments}
                draft={draft}
                onDraftChange={setDraft}
                activeThreadId={activeThreadId}
                onActivate={setActiveThreadId}
                onClose={() => setCommentsOpen(false)}
              />
            )}
          </div>
          {selectionAnchor !== undefined && pendingSelection !== undefined && (
            <SelectionPopover
              anchor={selectionAnchor}
              onComment={() => {
                setDraft(pendingSelection);
                setActiveThreadId(undefined);
                setCommentsOpen(true);
                setSelectionAnchor(undefined);
                setPendingSelection(undefined);
                window.getSelection()?.removeAllRanges();
              }}
            />
          )}
          {hasToc && tocFits && (
            <TableOfContents
              headings={viewerDocument.headings}
              articleRef={articleRef}
              layout="overlay"
              collapsed={!overlayOpen}
            />
          )}
        </div>
      </div>
    </ViewerModeContext.Provider>
  );
}

function useViewerMeta(enabled: boolean) {
  const [meta, setMeta] = useState<ViewerMeta>();
  useEffect(() => {
    if (!enabled) return;
    // oxlint-disable-next-line typescript/no-floating-promises -- React effects cannot await; this request owns the metadata update.
    void fetch("/__diffmap/meta")
      .then((response) => response.json())
      .then((value) => {
        // SAFETY: the diffmap CLI serves this shape from extractTitle.
        setMeta(value as ViewerMeta);
      });
  }, [enabled]);
  return meta;
}

async function closeViewer() {
  await fetch("/__diffmap/shutdown", { method: "POST" });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const COMMENTS_PANEL_WIDTH = "minmax(0, 340px)";
const DWELL_MS = 280;
const DWELL_LEAVE_PAD_PX = 48;
const TOC_DWELL_EDGE_PX = 48;
const TOC_DWELL_CANCEL_PX = 80;

const styles = {
  shell: style(flex({ direction: "column" }), {
    width: "100%",
    height: "100vh",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: colors.gray[4],
  }),
  header: style(
    flex({ direction: "row", alignItems: "center", justifyContent: "between" }),
    spacing.padding({ x: 6, y: 3 }),
    flexItem({ size: "hug" }),
    border(["bottom"], "border"),
    {
      minWidth: 0,
      backgroundColor: backgroundColor.app,
    },
  ),
  heading: style(flex({ direction: "row", alignItems: "center", gap: 3 }), {
    minWidth: 0,
    flex: "1 1 auto",
  }),
  title: style(text({ size: "md", fontWeight: 600, color: "highContrast" }), {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),
  actions: style(flex({ direction: "row", alignItems: "center", gap: 3 }), {
    flexShrink: 0,
  }),
  stage: style(flex({ direction: "column" }), {
    position: "relative",
    flex: "1 1 auto",
    minWidth: 0,
    minHeight: 0,
  }),
  body: style({
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr)",
    flex: "1 1 auto",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: backgroundColor.app,
    "--diffmap-columns": "minmax(0, 1fr)",
    "--diffmap-areas": '"article"',
    gridTemplateColumns: "var(--diffmap-columns)",
    gridTemplateAreas: "var(--diffmap-areas)",
    "&[data-has-source-diffs='true']": {
      "--diffmap-columns": "minmax(0, 1fr) minmax(0, 1fr)",
      "--diffmap-areas": '"article diff"',
    },
    "&[data-has-comments='true']": {
      "--diffmap-columns": `minmax(0, 1fr) ${COMMENTS_PANEL_WIDTH}`,
      "--diffmap-areas": '"article comments"',
    },
    "&[data-has-source-diffs='true'][data-has-comments='true']": {
      "--diffmap-columns": `minmax(0, 1fr) minmax(0, 1fr) ${COMMENTS_PANEL_WIDTH}`,
      "--diffmap-areas": '"article diff comments"',
    },
    "@media (max-width: 900px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr) auto auto",
      gridTemplateAreas: '"article" "diff" "comments"',
    },
  }),
  article: style(spacing.padding({ x: 12, y: 12 }), {
    gridArea: "article",
    flex: "1 1 auto",
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    backgroundColor: backgroundColor.app,
  }),
  prose: style({
    display: "grid",
    gridTemplateColumns: `minmax(0, 1fr) minmax(0, ${proseMaxWidth}) minmax(0, 1fr)`,
    width: "100%",
    maxWidth: "none",
    minWidth: 0,
  }),
  content: style({
    gridColumn: "2 / 3",
    width: "100%",
    maxWidth: "none",
    minWidth: 0,
    "& h1, & h2, & h3, & h4, & h5, & h6": {
      scrollMarginTop: spacing.value(4),
    },
    "& ul > li[data-task]::before, & ol > li[data-task]::before": {
      content: "none",
    },
    "& ul > li[data-task] > .diffmap-task-checkbox, & ol > li[data-task] > .diffmap-task-checkbox":
      {
        // Maui proseHtml md listPadding.
        position: "absolute",
        left: "-20px",
        top: "6px",
      },
    "& .diffmap-task-checkbox label > span:last-child": {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: 0,
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      whiteSpace: "nowrap",
      border: 0,
    },
  }),
  closed: style(
    flex({
      direction: "column",
      alignItems: "center",
      justifyContent: "center",
    }),
    spacing.padding({ x: 12, y: 12 }),
    {
      minHeight: "100vh",
      backgroundColor: backgroundColor.app,
    },
  ),
  closedCopy: style(
    flex({ direction: "column", alignItems: "center", gap: 3 }),
    {
      width: "100%",
      maxWidth: proseMaxWidth,
      textAlign: "center",
    },
  ),
};
