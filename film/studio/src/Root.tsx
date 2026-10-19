import { Composition } from "remotion";
import { Film } from "./Film";
import { T } from "./lib";

export const Root = () => (
  <Composition
    id="ApprovalsThatLearn"
    component={Film}
    durationInFrames={Math.round(T.duration * T.fps)}
    fps={T.fps}
    width={1920}
    height={1080}
  />
);
