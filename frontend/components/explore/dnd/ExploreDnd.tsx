"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FolderOpen } from "lucide-react";

import { useExploreStore } from "@/lib/explore/store";

import { useExplore, type PinInput } from "../ExploreContext";
import { useToast } from "../ui/Toast";

export const DROP_DOSSIER = "dropzone:dossier";
export const DROP_COMPARE = "dropzone:compare";

export interface DragPayload {
  label: string;
  /** Rendered in the drag overlay */
  icon?: ReactNode;
  pin: PinInput;
  /** Set when the item is an outlet (can go into the compare tray) */
  outletKey?: string;
}

interface DndState {
  active: DragPayload | null;
  /** True for a moment after a drag ended, to swallow the click that follows */
  justDragged: () => boolean;
}

const DndStateContext = createContext<DndState>({ active: null, justDragged: () => false });
export const useDndState = () => useContext(DndStateContext);

export function ExploreDndProvider({ children }: { children: ReactNode }) {
  const { pin, eventId } = useExplore();
  const setCompareSlot = useExploreStore((state) => state.setCompareSlot);
  const toast = useToast();
  const [active, setActive] = useState<DragPayload | null>(null);
  const lastDragEnd = useRef(0);

  const sensors = useSensors(
    // Long-press on touch so scrolling and tapping keep working
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActive((event.active.data.current as DragPayload | undefined) ?? null);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate?.(10);
      } catch {
        // ignore
      }
    }
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      lastDragEnd.current = Date.now();
      const payload = event.active.data.current as DragPayload | undefined;
      setActive(null);
      if (!payload) return;
      const overId = String(event.over?.id ?? "");
      if (overId.startsWith(DROP_DOSSIER)) {
        pin(payload.pin);
      } else if (overId.startsWith(DROP_COMPARE)) {
        if (payload.outletKey) {
          setCompareSlot(eventId, payload.outletKey);
          toast(`${payload.label} klaargezet om te vergelijken`);
        } else {
          toast("Alleen bronnen kun je vergelijken");
        }
      } else {
        toast("Sleep naar Dossier om te bewaren");
      }
    },
    [eventId, pin, setCompareSlot, toast],
  );

  const justDragged = useCallback(() => Date.now() - lastDragEnd.current < 250, []);

  return (
    <DndStateContext.Provider value={{ active, justDragged }}>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
        accessibility={{
          announcements: {
            onDragStart: () => "Opgepakt. Sleep naar het dossier om te bewaren.",
            onDragOver: ({ over }) => (over ? "Boven een doel. Laat los om te bewaren." : "Niet boven een doel."),
            onDragEnd: ({ over }) => (over ? "Bewaard." : "Losgelaten zonder doel."),
            onDragCancel: () => "Slepen geannuleerd.",
          },
          screenReaderInstructions: {
            draggable: "Houd ingedrukt om te slepen, of gebruik de knop Bewaar.",
          },
        }}
      >
        {children}
        {typeof document !== "undefined"
          ? createPortal(
              <DragOverlay dropAnimation={null} zIndex={60}>
                {active ? (
                  <div className="flex max-w-[240px] items-center gap-2 rounded-full border-2 border-accent-orange bg-white px-3 py-2 text-sm font-semibold text-ink-900 shadow-balloon">
                    {active.icon ?? <FolderOpen size={16} />}
                    <span className="truncate">{active.label}</span>
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>
    </DndStateContext.Provider>
  );
}

/** Wrap anything to make it draggable into the dossier (and the compare tray for outlets). */
export function Draggable({ id, payload, children, className = "" }: { id: string; payload: DragPayload; children: ReactNode; className?: string }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, data: payload });
  const { justDragged } = useDndState();
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      onContextMenu={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (justDragged()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      className={`no-callout touch-manipulation ${isDragging ? "opacity-40" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** Drop target helper for the dock. */
export function useDropZone(id: string) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return { setNodeRef, isOver };
}

/** Drop strip shown inside sheets while dragging (the dock is hidden behind the sheet). */
export function SheetDropStrip() {
  const { active } = useDndState();
  const { setNodeRef, isOver } = useDroppable({ id: `${DROP_DOSSIER}:sheet` });
  if (!active) return null;
  return (
    <div
      ref={setNodeRef}
      className={`sticky bottom-0 z-10 mt-3 flex min-h-[64px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-sm font-semibold transition-colors ${
        isOver ? "border-accent-orange bg-orange-50 text-accent-orange" : "border-paper-300 bg-paper-100 text-ink-600"
      }`}
    >
      <FolderOpen size={18} /> Laat los om in je dossier te bewaren
    </div>
  );
}
