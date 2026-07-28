"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  AppAction,
  AppState,
  CounterofferView,
  MarketView,
  OfferView,
  PairBalanceView,
  Selection,
} from "@/lib/contracts";
import { americanOdds } from "@/lib/domain";

type Tab = "board" | "bets" | "settle" | "markets";

export function BettingApp({
  viewer,
  signOutPath,
}: {
  viewer: { displayName: string };
  signOutPath: string;
}) {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("loading");
  const [offerSelections, setOfferSelections] = useState<
    Record<string, Selection>
  >({});

  const loadState = useCallback(async () => {
    setBusy("loading");
    setError(null);
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(apiMessage(payload));
      setState(payload as AppState);
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    // The initial request intentionally owns the loading-state transition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadState();
  }, [loadState]);

  const runAction = useCallback(
    async (action: AppAction, successMessage: string) => {
      setBusy(action.type);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch("/api/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(apiMessage(payload));
        setState(payload as AppState);
        setNotice(successMessage);
      } catch (actionError) {
        setError(messageOf(actionError));
        throw actionError;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const openOffers =
    state?.offers.filter((offer) => offer.status === "open") ?? [];
  const myPendingBets =
    state?.bets.filter(
      (bet) => bet.isParticipant && bet.status === "pending",
    ).length ?? 0;
  const myNetCents =
    state?.pairBalances.reduce((total, balance) => {
      if (balance.iOwe) return total - balance.amountCents;
      if (balance.owedToMe) return total + balance.amountCents;
      return total;
    }, 0) ?? 0;

  return (
    <main className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="brand-lockup inverse"
          onClick={() => setTab("board")}
          aria-label="Sidebet board"
        >
          <span className="brand-mark">S/B</span>
          <span>SIDEBET</span>
        </button>
        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => void loadState()}
            aria-label="Refresh board"
            disabled={busy !== null}
          >
            <span aria-hidden="true">{busy === "loading" ? "…" : "↻"}</span>
          </button>
          <div className="user-chip">
            <span className="avatar">{initials(viewer.displayName)}</span>
            <span>{viewer.displayName}</span>
          </div>
          <a className="sign-out" href={signOutPath}>
            Sign out
          </a>
        </div>
      </header>

      <section className="app-intro">
        <div className="app-intro-copy">
          <h1>
            The board is open, <em>{firstName(viewer.displayName)}.</em>
          </h1>
          <p>
            Post a line, work the odds, or settle what&apos;s already finished.
          </p>
        </div>
        <div className="score-strip">
          <Metric
            value={String(openOffers.length)}
            label="Open offers"
            tone="acid"
          />
          <Metric
            value={String(myPendingBets)}
            label="My live bets"
            tone="paper"
          />
          <Metric
            value={money(Math.abs(myNetCents))}
            label={
              myNetCents < 0
                ? "You owe"
                : myNetCents > 0
                  ? "Owed to you"
                  : "Net settled"
            }
            tone="coral"
          />
        </div>
      </section>

      <nav className="tab-bar" aria-label="Sidebet sections">
        <TabButton
          active={tab === "board"}
          onClick={() => setTab("board")}
          count={openOffers.length}
        >
          The board
        </TabButton>
        <TabButton active={tab === "bets"} onClick={() => setTab("bets")}>
          Matched bets
        </TabButton>
        <TabButton
          active={tab === "settle"}
          onClick={() => setTab("settle")}
          count={state?.pairBalances.length ?? 0}
        >
          Settle up
        </TabButton>
        <TabButton
          active={tab === "markets"}
          onClick={() => setTab("markets")}
        >
          Markets
        </TabButton>
      </nav>

      {(error || notice) && (
        <div
          className={`flash ${error ? "flash-error" : "flash-success"}`}
          role={error ? "alert" : "status"}
        >
          <span>{error ?? notice}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}

      {busy === "loading" && !state ? (
        <LoadingBoard />
      ) : !state ? (
        <section className="empty-state">
          <span className="empty-number">!</span>
          <h2>Couldn&apos;t load the board</h2>
          <p>{error ?? "Try refreshing in a moment."}</p>
          <button className="button-dark" onClick={() => void loadState()}>
            Try again
          </button>
        </section>
      ) : (
        <>
          {tab === "board" && (
            <BoardTab
              state={state}
              busy={busy}
              onAction={runAction}
              onOpenMarkets={() => setTab("markets")}
              selections={offerSelections}
              onSelectionsChange={setOfferSelections}
            />
          )}
          {tab === "bets" && <BetsTab state={state} />}
          {tab === "settle" && (
            <SettleTab state={state} busy={busy} onAction={runAction} />
          )}
          {tab === "markets" && (
            <MarketsTab
              state={state}
              busy={busy}
              onAction={runAction}
              onCreateOffer={(marketId, selection) => {
                setOfferSelections({ [marketId]: selection });
                setTab("board");
              }}
            />
          )}
        </>
      )}

      <footer className="app-footer">
        <div>
          <strong>OFFLINE MEANS OFFLINE.</strong>
          <span>
            Sidebet records agreements between friends. It never moves or
            verifies money.
          </span>
        </div>
        <span>All times shown locally · Amounts shown in USD</span>
      </footer>
    </main>
  );
}

function BoardTab({
  state,
  busy,
  onAction,
  onOpenMarkets,
  selections,
  onSelectionsChange,
}: {
  state: AppState;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
  onOpenMarkets: () => void;
  selections: Record<string, Selection>;
  onSelectionsChange: (
    selections:
      | Record<string, Selection>
      | ((current: Record<string, Selection>) => Record<string, Selection>),
  ) => void;
}) {
  const openOffers = state.offers.filter((offer) => offer.status === "open");

  return (
    <section className="board-grid">
      <OfferComposer
        markets={state.markets}
        busy={busy}
        onAction={onAction}
        onOpenMarkets={onOpenMarkets}
        selections={selections}
        onSelectionsChange={onSelectionsChange}
      />
      <div className="feed-column">
        <div className="section-heading">
          <div>
            <h2>Offers waiting for a friend</h2>
          </div>
          <span className="count-pill">{openOffers.length} open</span>
        </div>
        {openOffers.length === 0 ? (
          <EmptyCard
            label="NO OFFERS"
            title="The board is wide open"
            body="Create the first offer, or add a market if there is nothing worth calling yet."
          />
        ) : (
          <div className="offer-list">
            {openOffers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                busy={busy}
                onAction={onAction}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function OfferComposer({
  markets,
  busy,
  onAction,
  onOpenMarkets,
  selections,
  onSelectionsChange,
}: {
  markets: MarketView[];
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
  onOpenMarkets: () => void;
  selections: Record<string, Selection>;
  onSelectionsChange: (
    selections:
      | Record<string, Selection>
      | ((current: Record<string, Selection>) => Record<string, Selection>),
  ) => void;
}) {
  const availableMarkets = markets.filter((market) => market.status === "open");
  const [makerRisk, setMakerRisk] = useState("20");
  const [takerRisk, setTakerRisk] = useState("20");
  const selectedCount = Object.keys(selections).length;
  const makerRiskCents = toCents(makerRisk);
  const takerRiskCents = toCents(takerRisk);
  const odds =
    makerRiskCents > 0 && takerRiskCents > 0
      ? americanOdds(makerRiskCents, takerRiskCents)
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selectedCount === 0 || makerRiskCents < 1 || takerRiskCents < 1) return;
    await onAction(
      {
        type: "create_offer",
        makerRiskCents,
        takerRiskCents,
        legs: Object.entries(selections).map(([marketId, selection]) => ({
          marketId,
          selection,
        })),
      },
      "Offer posted to the board.",
    );
    onSelectionsChange({});
  }

  return (
    <aside className="composer-card">
      <div className="composer-topline">
        <span>MAKE A CALL</span>
        <span className="draft-badge">
          {selectedCount > 1 ? `${selectedCount}-LEG PARLAY` : "STRAIGHT"}
        </span>
      </div>
      <h2>What are you willing to put your name on?</h2>

      {availableMarkets.length === 0 ? (
        <div className="composer-empty">
          <span>NO ELIGIBLE MARKETS</span>
          <p>
            Create an open market first, then choose a side and set your terms.
          </p>
          <button type="button" onClick={onOpenMarkets}>
            Go to markets →
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="market-picker">
            {availableMarkets.map((market, index) => (
              <div className="market-choice" key={market.id}>
                <div className="market-choice-head">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{market.question}</p>
                </div>
                <div className="side-toggle">
                  <button
                    type="button"
                    className={selections[market.id] === "a" ? "selected" : ""}
                    onClick={() =>
                      onSelectionsChange((current) =>
                        toggleSelection(current, market.id, "a"),
                      )
                    }
                  >
                    {market.selectionA}
                  </button>
                  <button
                    type="button"
                    className={selections[market.id] === "b" ? "selected" : ""}
                    onClick={() =>
                      onSelectionsChange((current) =>
                        toggleSelection(current, market.id, "b"),
                      )
                    }
                  >
                    {market.selectionB}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="terms-editor">
            <MoneyInput
              label="You risk"
              value={makerRisk}
              onChange={setMakerRisk}
            />
            <span className="terms-divider">TO WIN</span>
            <MoneyInput
              label="Friend risks"
              value={takerRisk}
              onChange={setTakerRisk}
            />
          </div>
          <div className="composer-summary">
            <div>
              <span>Your displayed odds</span>
              <strong>{odds === null ? "—" : formatOdds(odds)}</strong>
            </div>
            <p>
              Your friend takes the opposite side and risks{" "}
              <b>{takerRiskCents > 0 ? money(takerRiskCents) : "—"}</b>.
            </p>
          </div>
          <button
            className="post-offer-button"
            type="submit"
            disabled={
              busy !== null ||
              selectedCount === 0 ||
              makerRiskCents < 1 ||
              takerRiskCents < 1
            }
          >
            <span>Post this offer</span>
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      )}
    </aside>
  );
}

function OfferCard({
  offer,
  busy,
  onAction,
}: {
  offer: OfferView;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
}) {
  const [countering, setCountering] = useState(false);
  const activeCounters = offer.counters.filter(
    (counter) => counter.status === "pending",
  );
  const odds = americanOdds(offer.makerRiskCents, offer.takerRiskCents);

  return (
    <article className="offer-card">
      <div className="offer-card-head">
        <div className="offer-maker">
          <span className="avatar avatar-ink">{initials(offer.makerName)}</span>
          <div>
            <strong>{offer.makerName}</strong>
            <span>{relativeTime(offer.createdAt)}</span>
          </div>
        </div>
        <div className="offer-badges">
          <span>{offer.legs.length > 1 ? `${offer.legs.length}-LEG` : "1-ON-1"}</span>
          <b>{formatOdds(odds)}</b>
        </div>
      </div>

      <div className="offer-legs">
        {offer.legs.map((leg, index) => (
          <div className="offer-leg" key={`${offer.id}-${leg.marketId}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <p>{leg.marketQuestion}</p>
              <strong>{leg.makerSelectionLabel}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="offer-stakes">
        <div>
          <span>{offer.makerName} risks</span>
          <strong>{money(offer.makerRiskCents)}</strong>
        </div>
        <span className="vs-mark">VS</span>
        <div>
          <span>Opponent risks</span>
          <strong>{money(offer.takerRiskCents)}</strong>
        </div>
      </div>

      {activeCounters.length > 0 && (
        <div className="counter-stack">
          <p className="counter-label">
            {activeCounters.length} live counter
            {activeCounters.length === 1 ? "" : "s"}
          </p>
          {activeCounters.map((counter) => (
            <CounterRow
              key={counter.id}
              offer={offer}
              counter={counter}
              busy={busy}
              onAction={onAction}
            />
          ))}
        </div>
      )}

      <div className="offer-actions">
        {offer.isMine ? (
          <button
            type="button"
            className="button-quiet danger"
            disabled={busy !== null}
            onClick={() =>
              void onAction(
                { type: "cancel_offer", offerId: offer.id },
                "Offer cancelled.",
              )
            }
          >
            Cancel offer
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button-accept"
              disabled={busy !== null}
              onClick={() =>
                void onAction(
                  { type: "accept_offer", offerId: offer.id },
                  "Bet matched. It is officially on the record.",
                )
              }
            >
              Take the other side
            </button>
            <button
              type="button"
              className="button-counter"
              onClick={() => setCountering((current) => !current)}
            >
              Counter terms
            </button>
          </>
        )}
      </div>

      {countering && !offer.isMine && (
        <CounterForm
          offer={offer}
          busy={busy}
          onAction={onAction}
          onDone={() => setCountering(false)}
        />
      )}
    </article>
  );
}

function CounterRow({
  offer,
  counter,
  busy,
  onAction,
}: {
  offer: OfferView;
  counter: CounterofferView;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
}) {
  const [countering, setCountering] = useState(false);

  return (
    <div className="counter-row">
      <div className="counter-copy">
        <span>{counter.proposerName} proposes</span>
        <strong>
          {money(counter.makerRiskCents)} ↔ {money(counter.takerRiskCents)}
        </strong>
        <small>Waiting on {counter.recipientName}</small>
      </div>
      {counter.canRespond && (
        <div className="counter-actions">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void onAction(
                {
                  type: "accept_offer",
                  offerId: offer.id,
                  counterId: counter.id,
                },
                "Counter accepted. The bet is matched.",
              )
            }
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => setCountering((current) => !current)}
          >
            Counter
          </button>
        </div>
      )}
      {countering && (
        <CounterForm
          offer={offer}
          parent={counter}
          busy={busy}
          onAction={onAction}
          onDone={() => setCountering(false)}
        />
      )}
    </div>
  );
}

function CounterForm({
  offer,
  parent,
  busy,
  onAction,
  onDone,
}: {
  offer: OfferView;
  parent?: CounterofferView;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
  onDone: () => void;
}) {
  const [makerRisk, setMakerRisk] = useState(
    centsToInput(parent?.makerRiskCents ?? offer.makerRiskCents),
  );
  const [takerRisk, setTakerRisk] = useState(
    centsToInput(parent?.takerRiskCents ?? offer.takerRiskCents),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const makerRiskCents = toCents(makerRisk);
    const takerRiskCents = toCents(takerRisk);
    if (makerRiskCents < 1 || takerRiskCents < 1) return;
    await onAction(
      {
        type: "create_counteroffer",
        offerId: offer.id,
        parentCounterId: parent?.id,
        makerRiskCents,
        takerRiskCents,
      },
      "Counteroffer sent.",
    );
    onDone();
  }

  return (
    <form className="counter-form" onSubmit={submit}>
      <p>
        Terms stay in the original maker&apos;s perspective. No money is held.
      </p>
      <div>
        <MoneyInput
          label={`${offer.makerName} risks`}
          value={makerRisk}
          onChange={setMakerRisk}
          compact
        />
        <MoneyInput
          label="Opponent risks"
          value={takerRisk}
          onChange={setTakerRisk}
          compact
        />
      </div>
      <button
        className="button-dark"
        type="submit"
        disabled={
          busy !== null || toCents(makerRisk) < 1 || toCents(takerRisk) < 1
        }
      >
        Send counter
      </button>
    </form>
  );
}

function BetsTab({ state }: { state: AppState }) {
  return (
    <section className="single-column">
      <div className="section-heading large">
        <div>
          <h2>Every matched bet</h2>
        </div>
        <span className="count-pill">{state.bets.length} total</span>
      </div>
      {state.bets.length === 0 ? (
        <EmptyCard
          label="NO BETS"
          title="Nothing matched yet"
          body="Take an offer from the board or negotiate terms with a friend."
        />
      ) : (
        <div className="bets-grid">
          {state.bets.map((bet) => (
            <article
              className={`bet-card ${bet.isParticipant ? "mine" : ""}`}
              key={bet.id}
            >
              <div className="bet-status-line">
                <StatusBadge status={bet.status} />
                <span>{relativeTime(bet.acceptedAt)}</span>
              </div>
              <h3>
                {bet.makerName} <span>vs</span> {bet.takerName}
              </h3>
              <div className="bet-leg-list">
                {bet.legs.map((leg) => (
                  <div key={`${bet.id}-${leg.marketId}`}>
                    <span>{leg.makerSelectionLabel}</span>
                    <p>{leg.marketQuestion}</p>
                  </div>
                ))}
              </div>
              <div className="bet-bottom">
                <div>
                  <span>{bet.makerName} risks</span>
                  <b>{money(bet.makerRiskCents)}</b>
                </div>
                <div>
                  <span>{bet.takerName} risks</span>
                  <b>{money(bet.takerRiskCents)}</b>
                </div>
              </div>
              {bet.isParticipant && (
                <span className="participant-ribbon">
                  YOUR SIDE: {bet.mySide?.toUpperCase()}
                </span>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SettleTab({
  state,
  busy,
  onAction,
}: {
  state: AppState;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
}) {
  return (
    <section className="settle-grid">
      <div>
        <div className="section-heading">
          <div>
            <h2>Who owes who</h2>
          </div>
        </div>
        <div className="balance-list">
          {state.pairBalances.length === 0 ? (
            <EmptyCard
              label="SETTLED"
              title="Everybody is square"
              body="Resolved bets and confirmed offline payments will appear here."
            />
          ) : (
            state.pairBalances.map((balance) => (
              <BalanceCard
                key={`${balance.debtorUserId}-${balance.creditorUserId}`}
                balance={balance}
                busy={busy}
                onAction={onAction}
              />
            ))
          )}
        </div>
      </div>

      <aside className="settlement-panel">
        <div className="section-heading">
          <div>
            <h2>Offline confirmations</h2>
          </div>
        </div>
        {state.settlements.length === 0 ? (
          <p className="panel-empty">
            When someone marks a debt paid, the other friend confirms it here.
          </p>
        ) : (
          <div className="settlement-list">
            {state.settlements.map((settlement) => (
              <div className="settlement-row" key={settlement.id}>
                <div>
                  <StatusBadge status={settlement.status} />
                  <p>
                    <strong>{settlement.debtorName}</strong> marked{" "}
                    <b>{money(settlement.amountCents)}</b> paid to{" "}
                    <strong>{settlement.creditorName}</strong>.
                  </p>
                  <span>{relativeTime(settlement.proposedAt)}</span>
                </div>
                {settlement.canRespond && (
                  <div className="settlement-actions">
                    <button
                      type="button"
                      className="button-accept"
                      disabled={busy !== null}
                      onClick={() =>
                        void onAction(
                          {
                            type: "respond_offline_settlement",
                            settlementId: settlement.id,
                            decision: "confirmed",
                          },
                          "Payment confirmed. The debt board is updated.",
                        )
                      }
                    >
                      Confirm received
                    </button>
                    <button
                      type="button"
                      className="button-quiet danger"
                      disabled={busy !== null}
                      onClick={() =>
                        void onAction(
                          {
                            type: "respond_offline_settlement",
                            settlementId: settlement.id,
                            decision: "rejected",
                          },
                          "Payment claim rejected.",
                        )
                      }
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>
    </section>
  );
}

function BalanceCard({
  balance,
  busy,
  onAction,
}: {
  balance: PairBalanceView;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
}) {
  const [settling, setSettling] = useState(false);
  const [amount, setAmount] = useState(centsToInput(balance.amountCents));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = toCents(amount);
    if (!balance.iOwe || amountCents < 1) return;
    await onAction(
      {
        type: "propose_offline_settlement",
        creditorUserId: balance.creditorUserId,
        amountCents,
      },
      "Marked paid. Waiting for your friend to confirm.",
    );
    setSettling(false);
  }

  return (
    <article className={`balance-card ${balance.involvesMe ? "mine" : ""}`}>
      <div className="balance-names">
        <span className="avatar avatar-coral">
          {initials(balance.debtorName)}
        </span>
        <div>
          <p>
            <strong>{balance.debtorName}</strong> owes
          </p>
          <p>{balance.creditorName}</p>
        </div>
      </div>
      <strong className="balance-amount">{money(balance.amountCents)}</strong>
      {balance.iOwe && (
        <button
          type="button"
          className="button-dark"
          onClick={() => setSettling((current) => !current)}
        >
          Mark paid offline
        </button>
      )}
      {settling && (
        <form className="settle-form" onSubmit={submit}>
          <MoneyInput
            label="Amount paid"
            value={amount}
            onChange={setAmount}
            compact
          />
          <button
            type="submit"
            disabled={
              busy !== null ||
              toCents(amount) < 1 ||
              toCents(amount) > balance.amountCents
            }
          >
            Send for confirmation
          </button>
        </form>
      )}
    </article>
  );
}

function MarketsTab({
  state,
  busy,
  onAction,
  onCreateOffer,
}: {
  state: AppState;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
  onCreateOffer: (marketId: string, selection: Selection) => void;
}) {
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [selectionA, setSelectionA] = useState("Yes");
  const [selectionB, setSelectionB] = useState("No");
  const [closesAt, setClosesAt] = useState(defaultCloseTime());

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onAction(
      {
        type: "create_market",
        question,
        description,
        selectionA,
        selectionB,
        closesAt: new Date(closesAt).toISOString(),
      },
      "Market opened. Friends can post offers now.",
    );
    setQuestion("");
    setDescription("");
    setSelectionA("Yes");
    setSelectionB("No");
    setClosesAt(defaultCloseTime());
  }

  return (
    <section className="markets-grid">
      <form className="market-form" onSubmit={submit}>
        <h2>Create a market</h2>
        <p className="form-note">
          Market creators can place offers too. You still resolve the result,
          and every action stays public to the group.
        </p>
        <label>
          <span>The question</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Will Mike get a girlfriend by July 27, 2027?"
            minLength={5}
            maxLength={160}
            required
          />
        </label>
        <label>
          <span>Context (optional)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add the exact rules so nobody argues later."
            maxLength={500}
          />
        </label>
        <div className="two-field">
          <label>
            <span>Side A</span>
            <input
              value={selectionA}
              onChange={(event) => setSelectionA(event.target.value)}
              maxLength={60}
              required
            />
          </label>
          <label>
            <span>Side B</span>
            <input
              value={selectionB}
              onChange={(event) => setSelectionB(event.target.value)}
              maxLength={60}
              required
            />
          </label>
        </div>
        <label>
          <span>Betting closes</span>
          <input
            type="datetime-local"
            value={closesAt}
            onChange={(event) => setClosesAt(event.target.value)}
            required
          />
        </label>
        <button
          className="post-offer-button"
          type="submit"
          disabled={busy !== null || question.trim().length < 5}
        >
          <span>Open market</span>
          <span aria-hidden="true">↗</span>
        </button>
      </form>

      <div className="market-ledger">
        <div className="section-heading">
          <div>
            <h2>All markets</h2>
          </div>
          <span className="count-pill">{state.markets.length}</span>
        </div>
        {state.markets.length === 0 ? (
          <EmptyCard
            label="NO MARKETS"
            title="Create the first market"
            body="Write clear outcomes and a real deadline. Friends set their own odds."
          />
        ) : (
          <div className="market-list">
            {state.markets.map((market) => (
              <article className="market-row" key={market.id}>
                <div className="market-state">
                  <StatusBadge status={market.status} />
                  <span>by {market.creatorName}</span>
                </div>
                <h3>{market.question}</h3>
                {market.description && <p>{market.description}</p>}
                <div className="market-sides">
                  <span
                    className={
                      market.winningSelection === "a" ? "winner" : ""
                    }
                  >
                    A · {market.selectionA}
                  </span>
                  <span
                    className={
                      market.winningSelection === "b" ? "winner" : ""
                    }
                  >
                    B · {market.selectionB}
                  </span>
                </div>
                {market.status === "open" && (
                  <div className="market-offer-actions">
                    <span>Put your name on it</span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onCreateOffer(market.id, "a")}
                    >
                      Offer on {market.selectionA}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onCreateOffer(market.id, "b")}
                    >
                      Offer on {market.selectionB}
                    </button>
                  </div>
                )}
                <div className="market-row-footer">
                  <span>Closes {dateTime(market.closesAt)}</span>
                  {market.createdByMe && market.status === "open" && (
                    <div className="resolve-actions">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void onAction(
                            {
                              type: "resolve_market",
                              marketId: market.id,
                              result: "a",
                            },
                            `${market.selectionA} recorded as the winner.`,
                          )
                        }
                      >
                        {market.selectionA} won
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void onAction(
                            {
                              type: "resolve_market",
                              marketId: market.id,
                              result: "b",
                            },
                            `${market.selectionB} recorded as the winner.`,
                          )
                        }
                      >
                        {market.selectionB} won
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busy !== null}
                        onClick={() =>
                          void onAction(
                            {
                              type: "resolve_market",
                              marketId: market.id,
                              result: "void",
                            },
                            "Market voided.",
                          )
                        }
                      >
                        Void
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "acid" | "paper" | "coral";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={active ? "active" : ""}
      onClick={onClick}
    >
      <span>{children}</span>
      {count !== undefined && <b>{count}</b>}
    </button>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className={`money-input ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <div>
        <b>$</b>
        <input
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
        />
      </div>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status.replaceAll("_", "-")}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

function EmptyCard({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="empty-card">
      <span>{label}</span>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

function LoadingBoard() {
  return (
    <section className="loading-board" role="status" aria-label="Loading board">
      <div />
      <div>
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function toggleSelection(
  current: Record<string, Selection>,
  marketId: string,
  selection: Selection,
): Record<string, Selection> {
  if (current[marketId] === selection) {
    const next = { ...current };
    delete next[marketId];
    return next;
  }
  return { ...current, [marketId]: selection };
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function toCents(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] || "friend";
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function defaultCloseTime(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function apiMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return "The request could not be completed.";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
