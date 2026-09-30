"use client";

import { createContext, useContext } from "react";

/**
 * Element that floating balloons inside a sheet must portal into (so taps don't close the sheet and
 * the balloon is not aria-hidden by the dialog). undefined = not inside a sheet (portal to body);
 * null = inside a sheet that is not mounted yet (floating-ui waits).
 *
 * Kept separate from Sheet.tsx so balloons don't pull the sheet library into the initial bundle.
 */
export const PortalRootContext = createContext<HTMLElement | null | undefined>(undefined);
export const usePortalRoot = () => useContext(PortalRootContext);
