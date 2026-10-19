import { createContext, useContext } from "react";

/** Where a tool call sits among calls of the same name for one request. */
export interface CallPosition {
  /** An earlier call with the same name exists (e.g. a policy re-check). */
  repeat: boolean;
  /** A later call with the same name replaced this one. */
  superseded: boolean;
}

export const CallPositionContext = createContext<CallPosition>({ repeat: false, superseded: false });
export const useCallPosition = () => useContext(CallPositionContext);
