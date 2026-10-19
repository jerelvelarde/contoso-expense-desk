import { AnimatePresence, motion } from "motion/react";
import { totalOf, type ExpenseRequest } from "../agent/contract";
import { money, relativeTime, useNow } from "../lib/format";
import { useDesk } from "../desk/DeskProvider";
import { DetailsCard } from "./DetailsCard";
import { LearnedAnnouncement } from "./Learned";
import { Timeline } from "./Timeline";
import { Avatar, StatusPill } from "./ui";

export function RequestDetail({ request }: { request: ExpenseRequest }) {
  const now = useNow();
  const total = totalOf(request);
  const person = request.employee;
  const name = person?.name ?? request.requester.name;
  // Fields become editable once the agent has finished reading and checking them.
  const showDetails = request.status !== "received" && request.status !== "checking";
  const { desk, announcedRuleId } = useDesk();
  const announced = desk.learnedRules.find((r) => r.id === announcedRuleId);

  return (
    <motion.article key={request.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-8 px-10 py-5 max-[1360px]:px-8">
          <div className="min-w-0">
            <h1 className="truncate text-[22px] leading-7 font-semibold tracking-[-0.01em] text-ink">
              Hotel in {request.city}
              <span className="font-normal text-ink-3"> · {request.purpose}</span>
            </h1>
            <div className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-2">
              <Avatar name={name} size={20} />
              <span className="font-medium text-ink">{name}</span>
              {person ? (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="truncate">
                  {person.title}
                </motion.span>
              ) : null}
              <span aria-hidden className="text-line-strong">|</span>
              <span className="shrink-0 font-mono text-xs text-ink-3">{request.id}</span>
              <span className="shrink-0 text-ink-3">{relativeTime(request.createdAt, now)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-5">
            {/* While the agent works, the live timeline step already says so. */}
            {showDetails ? <StatusPill request={request} /> : null}
            <motion.span
              key={total}
              initial={{ opacity: 0.3 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="text-[26px] leading-none font-semibold tracking-[-0.01em] text-ink tabular"
            >
              {money(total)}
            </motion.span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1080px] grid-cols-[minmax(0,1fr)_300px] gap-12 px-10 pt-7 pb-16 max-[1360px]:grid-cols-[minmax(0,1fr)_280px] max-[1360px]:gap-8 max-[1360px]:px-8">
        <section aria-label="Agent activity">
          <h2 className="mb-5 text-xs font-medium text-ink-3">Agent activity</h2>
          <Timeline request={request} />
        </section>
        <aside>
          <div className="sticky top-[124px]">
            <AnimatePresence mode="wait" initial={false}>
              {announced ? (
                <motion.div key={`learned-${announced.id}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <LearnedAnnouncement rule={announced} />
                </motion.div>
              ) : showDetails ? (
                <motion.div key="details" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                  <DetailsCard request={request} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </aside>
      </div>
    </motion.article>
  );
}

export function EmptyDetail({ connected }: { connected: boolean }) {
  return (
    <div className="grid h-full place-items-center px-10">
      <div className="max-w-[400px] text-center">
        <p className="text-[20px] leading-7 font-semibold tracking-[-0.01em] text-ink">Nothing needs you right now</p>
        <p className="mx-auto mt-2 max-w-[340px] text-[14px] leading-6 text-ink-2">
          When someone messages @Expenses in Teams, their request opens here and you can watch the agent work through it.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1.5 text-xs text-ink-2">
          <span className={connected ? "size-1.5 rounded-full bg-ok" : "size-1.5 animate-pulse rounded-full bg-ink-3"} />
          {connected ? "Listening for Teams messages" : "Connecting to the agent…"}
        </div>
      </div>
    </div>
  );
}
