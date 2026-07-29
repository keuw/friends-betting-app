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
  BetRevisionView,
  BetView,
  CounterofferView,
  MarketRevisionView,
  MarketStatus,
  MarketView,
  OfferView,
  PairBalanceView,
  ParlayPosition,
  Selection,
} from "@/lib/contracts";
import { americanOdds } from "@/lib/domain";
import {
  filterAndSortMarkets,
  type MarketLedgerFilter,
} from "@/lib/market-ledger";

type Tab = "board" | "bets" | "settle" | "markets";

const MAX_PARLAY_LEGS = 8;
const MARKET_BATCH_SIZE = 8;
const MARKET_STATUS_FILTERS: {
  value: MarketLedgerFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "void", label: "Voided" },
];

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
        if (!response.ok) {
          const errorCode = apiErrorCode(payload);
          if (
            errorCode === "COUNTER_STALE" ||
            errorCode === "MARKET_IN_USE" ||
            errorCode === "MARKET_CHANGED" ||
            errorCode === "BET_VOID_STALE" ||
            errorCode === "BET_REVISION_STALE"
          ) {
            const refreshResponse = await fetch("/api/state", {
              cache: "no-store",
            });
            if (refreshResponse.ok) {
              setState((await refreshResponse.json()) as AppState);
            }
          }
          throw new Error(apiMessage(payload));
        }
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
          {tab === "bets" && (
            <BetsTab state={state} busy={busy} onAction={runAction} />
          )}
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
  const availableMarkets = markets
    .filter((market) => market.status === "open")
    .sort(
      (left, right) =>
        new Date(left.closesAt).getTime() -
        new Date(right.closesAt).getTime(),
    );
  const [makerRisk, setMakerRisk] = useState("20");
  const [takerRisk, setTakerRisk] = useState("20");
  const [makerPosition, setMakerPosition] =
    useState<ParlayPosition>("back");
  const [marketQuery, setMarketQuery] = useState("");
  const [visibleMarketCount, setVisibleMarketCount] =
    useState(MARKET_BATCH_SIZE);
  const selectedCount = Object.keys(selections).length;
  const selectedMarkets = markets
    .filter((market) => selections[market.id])
    .sort(
      (left, right) =>
        new Date(left.closesAt).getTime() -
        new Date(right.closesAt).getTime(),
    );
  const normalizedQuery = marketQuery.trim().toLocaleLowerCase();
  const matchingMarkets = availableMarkets.filter((market) => {
    if (!normalizedQuery) return true;
    return [
      market.question,
      market.selectionA,
      market.selectionB,
      market.creatorName,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
  const visibleMarkets = matchingMarkets.slice(0, visibleMarketCount);
  const remainingMarketCount = matchingMarkets.length - visibleMarkets.length;
  const makerRiskCents = toCents(makerRisk);
  const takerRiskCents = toCents(takerRisk);
  const odds =
    makerRiskCents > 0 && takerRiskCents > 0
      ? americanOdds(makerRiskCents, takerRiskCents)
      : null;

  function chooseSelection(marketId: string, selection: Selection) {
    if (
      selections[marketId] === selection &&
      selectedCount <= 2
    ) {
      setMakerPosition("back");
    }
    onSelectionsChange((current) => {
      const isNewLeg = current[marketId] === undefined;
      if (isNewLeg && Object.keys(current).length >= MAX_PARLAY_LEGS) {
        return current;
      }
      return toggleSelection(current, marketId, selection);
    });
  }

  function removeSelection(marketId: string) {
    if (selectedCount <= 2) {
      setMakerPosition("back");
    }
    onSelectionsChange((current) => {
      if (current[marketId] === undefined) return current;
      const next = { ...current };
      delete next[marketId];
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selectedCount === 0 || makerRiskCents < 1 || takerRiskCents < 1) return;
    await onAction(
      {
        type: "create_offer",
        makerPosition: selectedCount > 1 ? makerPosition : "back",
        makerRiskCents,
        takerRiskCents,
        legs: Object.entries(selections).map(([marketId, selection]) => ({
          marketId,
          marketRevisionId:
            markets.find((market) => market.id === marketId)
              ?.currentRevisionId ?? "",
          selection,
        })),
      },
      "Offer posted to the board.",
    );
    onSelectionsChange({});
    setMakerPosition("back");
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
          {selectedMarkets.length > 0 && (
            <section
              className="selected-slip"
              aria-labelledby="selected-legs-title"
            >
              <div className="selected-slip-head">
                <span id="selected-legs-title">Selected legs</span>
                <b>
                  {selectedCount}/{MAX_PARLAY_LEGS}
                </b>
              </div>
              <div className="selected-slip-list">
                {selectedMarkets.map((market) => {
                  const selection = selections[market.id];
                  const selectionLabel =
                    selection === "a"
                      ? market.selectionA
                      : market.selectionB;
                  return (
                    <div className="selected-slip-leg" key={market.id}>
                      <div>
                        <strong>{selectionLabel}</strong>
                        <p>{market.question}</p>
                        <BettingDeadline value={market.closesAt} />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSelection(market.id)}
                        aria-label={`Remove ${selectionLabel} from your bet`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {selectedCount > 1 && (
            <section className="position-selector" aria-label="Parlay position">
              <div>
                <span>How are you playing it?</span>
                <div role="group" aria-label="Back or fade this parlay">
                  <button
                    type="button"
                    className={makerPosition === "back" ? "selected" : ""}
                    aria-pressed={makerPosition === "back"}
                    onClick={() => setMakerPosition("back")}
                  >
                    Back this parlay
                  </button>
                  <button
                    type="button"
                    className={makerPosition === "fade" ? "selected" : ""}
                    aria-pressed={makerPosition === "fade"}
                    onClick={() => setMakerPosition("fade")}
                  >
                    Fade this parlay
                  </button>
                </div>
              </div>
              <p>
                {makerPosition === "back"
                  ? "You win only if every non-void pick hits."
                  : "You play house: you win as soon as any pick misses."}
              </p>
            </section>
          )}

          <div className="market-browser-tools">
            <label className="market-search">
              <span>Search markets</span>
              <input
                type="search"
                value={marketQuery}
                onChange={(event) => {
                  setMarketQuery(event.target.value);
                  setVisibleMarketCount(MARKET_BATCH_SIZE);
                }}
                placeholder="Question, outcome, or creator"
              />
            </label>
            <div className="market-result-meta">
              <span>
                {matchingMarkets.length}{" "}
                {matchingMarkets.length === 1 ? "match" : "matches"}
              </span>
              <span>Up to 8 legs</span>
            </div>
          </div>

          <div className="market-picker">
            {visibleMarkets.length === 0 ? (
              <div className="market-search-empty">
                <strong>No markets found</strong>
                <p>Try another question, outcome, or friend&apos;s name.</p>
              </div>
            ) : (
              visibleMarkets.map((market, index) => {
                const newLegDisabled =
                  selectedCount >= MAX_PARLAY_LEGS && !selections[market.id];
                return (
                  <div className="market-choice" key={market.id}>
                    <div className="market-choice-head">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <p>{market.question}</p>
                        <BettingDeadline value={market.closesAt} />
                      </div>
                    </div>
                    <div className="side-toggle">
                      <button
                        type="button"
                        className={
                          selections[market.id] === "a" ? "selected" : ""
                        }
                        aria-pressed={selections[market.id] === "a"}
                        disabled={busy !== null || newLegDisabled}
                        onClick={() => chooseSelection(market.id, "a")}
                      >
                        {market.selectionA}
                      </button>
                      <button
                        type="button"
                        className={
                          selections[market.id] === "b" ? "selected" : ""
                        }
                        aria-pressed={selections[market.id] === "b"}
                        disabled={busy !== null || newLegDisabled}
                        onClick={() => chooseSelection(market.id, "b")}
                      >
                        {market.selectionB}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {remainingMarketCount > 0 && (
            <button
              className="show-more-markets"
              type="button"
              onClick={() =>
                setVisibleMarketCount(
                  (current) => current + MARKET_BATCH_SIZE,
                )
              }
            >
              Show more markets
              <span>
                +{Math.min(MARKET_BATCH_SIZE, remainingMarketCount)}
              </span>
            </button>
          )}
          {selectedCount >= MAX_PARLAY_LEGS && (
            <p className="leg-limit-note" role="status">
              Eight-leg limit reached. Remove a selected leg to choose another.
            </p>
          )}

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
            <span>
              <time dateTime={offer.createdAt}>
                Posted {dateTime(offer.createdAt)}
              </time>
            </span>
          </div>
        </div>
        <div className="offer-badges">
          {offer.legs.length > 1 && (
            <span className={`position-badge position-${offer.makerPosition}`}>
              {offer.makerPosition === "back"
                ? "BACKING PARLAY"
                : "FADING PARLAY"}
            </span>
          )}
          <span>{offer.legs.length > 1 ? `${offer.legs.length}-LEG` : "1-ON-1"}</span>
          <b>{formatOdds(odds)}</b>
        </div>
      </div>

      <div className="offer-legs">
        {offer.legs.map((leg, index) => (
          <div className="offer-leg" key={`${offer.id}-${leg.marketId}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <div>
                <p>{leg.marketQuestion}</p>
                <BettingDeadline value={leg.marketClosesAt} />
                <span className="revision-tag">
                  Market v{leg.marketRevisionNumber}
                </span>
              </div>
              <strong>{leg.makerSelectionLabel}</strong>
            </div>
          </div>
        ))}
      </div>

      {offer.legs.length > 1 && (
        <p className="position-rule">
          {parlayWinningRule(
            offer.makerName,
            "Opponent",
            offer.makerPosition,
          )}
        </p>
      )}

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
              ).catch(() => undefined)
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
                ).catch(() => undefined)
              }
            >
              {offer.legs.length > 1
                ? `${positionLabel(oppositePosition(offer.makerPosition))} this parlay`
                : "Take the other side"}
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
              ).catch(() => undefined)
            }
          >
            Accept as{" "}
            {positionLabel(
              offer.isMine
                ? offer.makerPosition
                : oppositePosition(offer.makerPosition),
            )}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setCountering((current) => !current)}
          >
            Counter
          </button>
          <button
            type="button"
            className="button-quiet danger"
            disabled={busy !== null}
            onClick={() =>
              void onAction(
                {
                  type: "decline_counteroffer",
                  counterId: counter.id,
                },
                "Counter declined. The original offer stays open.",
              ).catch(() => undefined)
            }
          >
            Decline
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
    try {
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
    } catch {
      return;
    }
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

function BetsTab({
  state,
  busy,
  onAction,
}: {
  state: AppState;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
}) {
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
            <BetCard
              key={bet.id}
              bet={bet}
              markets={state.markets}
              busy={busy}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BetCard({
  bet,
  markets,
  busy,
  onAction,
}: {
  bet: BetView;
  markets: MarketView[];
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [requestingVoid, setRequestingVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const pendingRevision = bet.revisions.find(
    (revision) => revision.status === "pending",
  );
  const pendingVoidRequest = bet.voidRequests.find(
    (request) => request.status === "pending",
  );
  const acceptedVoidRequest = bet.voidRequests.find(
    (request) => request.status === "accepted",
  );
  const activeRevision = bet.revisions.find(
    (revision) => revision.id === bet.currentRevisionId,
  );

  return (
    <article className={`bet-card ${bet.isParticipant ? "mine" : ""}`}>
      <div className="bet-status-line">
        <div>
          <StatusBadge status={bet.status} />
          <span className="revision-tag">
            Bet v{activeRevision?.revisionNumber ?? 1}
          </span>
        </div>
        <span>{relativeTime(bet.acceptedAt)}</span>
      </div>
      <h3>
        {bet.makerName} <span>vs</span> {bet.takerName}
      </h3>
      {bet.legs.length > 1 && (
        <div className="bet-position-summary">
          <strong>{parlayRoleSentence(bet)}</strong>
          <p>
            {parlayWinningRule(
              bet.makerName,
              bet.takerName,
              bet.makerPosition,
            )}
          </p>
        </div>
      )}
      <BetLegList betId={bet.id} legs={bet.legs} />
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

      {bet.status === "void" && acceptedVoidRequest && (
        <div className="void-agreement-summary">
          <strong>Voided by mutual agreement</strong>
          <p>
            {acceptedVoidRequest.requesterName} and{" "}
            {acceptedVoidRequest.recipientName} ended this pending bet with no
            debt. Reason: “{acceptedVoidRequest.reason}”
          </p>
        </div>
      )}

      {pendingRevision && (
        <section className="revision-proposal" aria-label="Pending bet revision">
          <div className="revision-proposal-head">
            <div>
              <span>CHANGE PROPOSED</span>
              <strong>Revision {pendingRevision.revisionNumber}</strong>
            </div>
            <StatusBadge status={pendingRevision.status} />
          </div>
          <p className="revision-note">
            “{pendingRevision.changeNote}” — {pendingRevision.proposerName}
          </p>
          <p className="revision-guardrail">
            Current terms stay active until your friend accepts.
          </p>
          <div className="revision-comparison">
            <BetTermsSummary
              label="Current"
              makerName={bet.makerName}
              takerName={bet.takerName}
              makerRiskCents={bet.makerRiskCents}
              takerRiskCents={bet.takerRiskCents}
              makerPosition={bet.makerPosition}
              legs={bet.legs}
            />
            <BetTermsSummary
              label="Proposed"
              makerName={bet.makerName}
              takerName={bet.takerName}
              makerRiskCents={pendingRevision.makerRiskCents}
              takerRiskCents={pendingRevision.takerRiskCents}
              makerPosition={pendingRevision.makerPosition}
              legs={pendingRevision.legs}
            />
          </div>
          {(pendingRevision.canRespond || pendingRevision.canCancel) && (
            <div className="revision-response-actions">
              {pendingRevision.canRespond && (
                <>
                  <button
                    type="button"
                    className="button-accept"
                    disabled={busy !== null}
                    onClick={() =>
                      void onAction(
                        {
                          type: "respond_bet_revision",
                          betRevisionId: pendingRevision.id,
                          decision: "accepted",
                        },
                        "Revision accepted. The updated terms are now active.",
                      )
                    }
                  >
                    Accept revision
                  </button>
                  <button
                    type="button"
                    className="button-quiet danger"
                    disabled={busy !== null}
                    onClick={() =>
                      void onAction(
                        {
                          type: "respond_bet_revision",
                          betRevisionId: pendingRevision.id,
                          decision: "rejected",
                        },
                        "Revision rejected. The current terms stay active.",
                      )
                    }
                  >
                    Reject
                  </button>
                </>
              )}
              {pendingRevision.canCancel && (
                <button
                  type="button"
                  className="button-quiet"
                  disabled={busy !== null}
                  onClick={() =>
                    void onAction(
                      {
                        type: "cancel_bet_revision",
                        betRevisionId: pendingRevision.id,
                      },
                      "Revision proposal cancelled.",
                    )
                  }
                >
                  Cancel proposal
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {pendingVoidRequest && (
        <section
          className="void-request-proposal"
          aria-label="Pending mutual void request"
        >
          <div className="revision-proposal-head">
            <div>
              <span>MUTUAL VOID REQUEST</span>
              <strong>
                {pendingVoidRequest.requesterName} asks{" "}
                {pendingVoidRequest.recipientName}
              </strong>
            </div>
            <StatusBadge status={pendingVoidRequest.status} />
          </div>
          <p className="void-request-reason">
            “{pendingVoidRequest.reason}”
          </p>
          <p className="void-request-guardrail">
            Based on bet v{pendingVoidRequest.baseRevisionNumber}. The bet stays
            active until the other participant accepts.
          </p>
          {(pendingVoidRequest.canRespond ||
            pendingVoidRequest.canCancel) && (
            <div className="revision-response-actions">
              {pendingVoidRequest.canRespond && (
                <>
                  <button
                    type="button"
                    className="button-accept"
                    disabled={busy !== null}
                    onClick={() =>
                      void onAction(
                        {
                          type: "respond_bet_void",
                          betVoidRequestId: pendingVoidRequest.id,
                          decision: "accepted",
                        },
                        "Both sides agreed. The matched bet is void with no debt.",
                      )
                    }
                  >
                    Agree and void bet
                  </button>
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={busy !== null}
                    onClick={() =>
                      void onAction(
                        {
                          type: "respond_bet_void",
                          betVoidRequestId: pendingVoidRequest.id,
                          decision: "rejected",
                        },
                        "Void request declined. The matched bet stays active.",
                      )
                    }
                  >
                    Keep bet active
                  </button>
                </>
              )}
              {pendingVoidRequest.canCancel && (
                <button
                  type="button"
                  className="button-quiet"
                  disabled={busy !== null}
                  onClick={() =>
                    void onAction(
                      {
                        type: "cancel_bet_void",
                        betVoidRequestId: pendingVoidRequest.id,
                      },
                      "Void request cancelled. The matched bet stays active.",
                    )
                  }
                >
                  Cancel request
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {editing && (
        <BetRevisionEditor
          bet={bet}
          markets={markets}
          busy={busy}
          onAction={onAction}
          onDone={() => setEditing(false)}
        />
      )}

      {requestingVoid && bet.canRequestVoid && (
        <form
          className="void-request-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onAction(
              {
                type: "request_bet_void",
                betId: bet.id,
                reason: voidReason,
              },
              "Void request sent. Your friend must agree before anything changes.",
            ).then(() => {
              setRequestingVoid(false);
              setVoidReason("");
            });
          }}
        >
          <div className="revision-editor-head">
            <div>
              <span>REQUEST MUTUAL VOID</span>
              <h4>Ask the other side to cancel this match</h4>
            </div>
            <span>No debt unless settled normally</span>
          </div>
          <p>
            Explain why. Your request and their response remain in the public
            bet history.
          </p>
          <label>
            <span>Reason</span>
            <textarea
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="We entered the wrong terms…"
              minLength={3}
              maxLength={200}
              required
            />
          </label>
          <div className="revision-editor-actions">
            <button
              type="submit"
              className="button-accept"
              disabled={busy !== null || voidReason.trim().length < 3}
            >
              Send void request
            </button>
            <button
              type="button"
              className="button-quiet"
              onClick={() => setRequestingVoid(false)}
            >
              Keep bet
            </button>
          </div>
        </form>
      )}

      <div className="bet-revision-actions">
        {bet.canProposeRevision && !pendingRevision && (
          <button
            type="button"
            className="button-dark"
            disabled={busy !== null}
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? "Close editor" : "Propose change"}
          </button>
        )}
        {bet.canRequestVoid && (
          <button
            type="button"
            className="button-quiet danger"
            disabled={busy !== null}
            onClick={() => setRequestingVoid((current) => !current)}
          >
            {requestingVoid ? "Close void request" : "Request mutual void"}
          </button>
        )}
        <button
          type="button"
          className="button-quiet"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((current) => !current)}
        >
          Bet history ({bet.revisions.length + bet.voidRequests.length})
        </button>
      </div>

      {showHistory && (
        <RevisionHistory
          revisions={bet.revisions}
          makerName={bet.makerName}
          takerName={bet.takerName}
          currentRevisionId={bet.currentRevisionId}
        />
      )}
      {showHistory && bet.voidRequests.length > 0 && (
        <VoidRequestHistory requests={bet.voidRequests} />
      )}

      {bet.isParticipant && (
        <span className="participant-ribbon">
          YOUR SIDE:{" "}
          {bet.legs.length > 1
            ? bet.myPosition?.toUpperCase()
            : bet.mySide?.toUpperCase()}
        </span>
      )}
    </article>
  );
}

function VoidRequestHistory({
  requests,
}: {
  requests: BetView["voidRequests"];
}) {
  return (
    <section className="revision-history void-request-history">
      <div className="revision-history-head">
        <span>Mutual void history</span>
        <small>Requests and responses stay public</small>
      </div>
      {requests
        .slice()
        .reverse()
        .map((request) => (
          <div className="revision-history-row" key={request.id}>
            <div>
              <strong>Bet v{request.baseRevisionNumber}</strong>
              <StatusBadge status={request.status} />
            </div>
            <p>“{request.reason}”</p>
            <small>
              {request.requesterName} asked {request.recipientName} ·{" "}
              {relativeTime(request.createdAt)}
            </small>
          </div>
        ))}
    </section>
  );
}

function BetRevisionEditor({
  bet,
  markets,
  busy,
  onAction,
  onDone,
}: {
  bet: BetView;
  markets: MarketView[];
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
  onDone: () => void;
}) {
  const [renderedAt] = useState(Date.now);
  const [makerRisk, setMakerRisk] = useState(centsToInput(bet.makerRiskCents));
  const [takerRisk, setTakerRisk] = useState(centsToInput(bet.takerRiskCents));
  const [changeNote, setChangeNote] = useState("");
  const [makerPosition, setMakerPosition] =
    useState<ParlayPosition>(bet.makerPosition);
  const [selections, setSelections] = useState<Record<string, Selection>>(
    Object.fromEntries(
      bet.legs.map((leg) => [leg.marketId, leg.makerSelection]),
    ),
  );
  const availableMarkets = markets
    .filter(
      (market) =>
        market.status === "open" &&
        new Date(market.closesAt).getTime() > renderedAt,
    )
    .sort(
      (left, right) =>
        new Date(left.closesAt).getTime() -
        new Date(right.closesAt).getTime(),
    );
  const selectedCount = Object.keys(selections).length;

  function chooseSelection(marketId: string, selection: Selection) {
    if (
      selections[marketId] === selection &&
      selectedCount <= 2
    ) {
      setMakerPosition("back");
    }
    setSelections((current) => {
      const isNew = current[marketId] === undefined;
      if (isNew && Object.keys(current).length >= MAX_PARLAY_LEGS) {
        return current;
      }
      return toggleSelection(current, marketId, selection);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const makerRiskCents = toCents(makerRisk);
    const takerRiskCents = toCents(takerRisk);
    const legs = Object.entries(selections).flatMap(
      ([marketId, selection]) => {
        const market = markets.find((item) => item.id === marketId);
        return market
          ? [
              {
                marketId,
                marketRevisionId: market.currentRevisionId,
                selection,
              },
            ]
          : [];
      },
    );
    if (
      makerRiskCents < 1 ||
      takerRiskCents < 1 ||
      legs.length === 0 ||
      changeNote.trim().length < 3
    ) {
      return;
    }
    await onAction(
      {
        type: "propose_bet_revision",
        betId: bet.id,
        makerPosition: legs.length > 1 ? makerPosition : "back",
        makerRiskCents,
        takerRiskCents,
        changeNote,
        legs,
      },
      "Change proposed. The current terms stay active until your friend accepts.",
    );
    onDone();
  }

  return (
    <form className="bet-revision-editor" onSubmit={submit}>
      <div className="revision-editor-head">
        <div>
          <span>PROPOSE REVISION</span>
          <h4>Rewrite the agreement together</h4>
        </div>
        <span>{selectedCount}/{MAX_PARLAY_LEGS} legs</span>
      </div>
      <p>
        Your friend must accept the complete revision. Every prior version
        remains visible.
      </p>
      <div className="terms-editor revision-terms">
        <MoneyInput
          label={`${bet.makerName} risks`}
          value={makerRisk}
          onChange={setMakerRisk}
          compact
        />
        <span className="terms-divider">VS</span>
        <MoneyInput
          label={`${bet.takerName} risks`}
          value={takerRisk}
          onChange={setTakerRisk}
          compact
        />
      </div>
      {selectedCount > 1 && (
        <section className="position-selector compact" aria-label="Revised parlay position">
          <div>
            <span>{bet.makerName}&apos;s position</span>
            <div role="group" aria-label="Revised Back or Fade position">
              <button
                type="button"
                className={makerPosition === "back" ? "selected" : ""}
                aria-pressed={makerPosition === "back"}
                onClick={() => setMakerPosition("back")}
              >
                Back
              </button>
              <button
                type="button"
                className={makerPosition === "fade" ? "selected" : ""}
                aria-pressed={makerPosition === "fade"}
                onClick={() => setMakerPosition("fade")}
              >
                Fade
              </button>
            </div>
          </div>
          <p>
            {parlayWinningRule(
              bet.makerName,
              bet.takerName,
              makerPosition,
            )}
          </p>
        </section>
      )}
      <label className="revision-change-note">
        <span>Why are you changing it?</span>
        <textarea
          value={changeNote}
          onChange={(event) => setChangeNote(event.target.value)}
          placeholder="Corrected the deadline and added the second leg."
          minLength={3}
          maxLength={200}
          required
        />
      </label>
      <div className="revision-market-list">
        {availableMarkets.map((market) => (
          <div className="revision-market-option" key={market.id}>
            <div>
              <strong>{market.question}</strong>
              <BettingDeadline value={market.closesAt} />
              <span className="revision-tag">
                Market v{market.revisionNumber}
              </span>
            </div>
            <div className="side-toggle">
              <button
                type="button"
                className={selections[market.id] === "a" ? "selected" : ""}
                aria-pressed={selections[market.id] === "a"}
                disabled={
                  busy !== null ||
                  (selectedCount >= MAX_PARLAY_LEGS &&
                    selections[market.id] === undefined)
                }
                onClick={() => chooseSelection(market.id, "a")}
              >
                {market.selectionA}
              </button>
              <button
                type="button"
                className={selections[market.id] === "b" ? "selected" : ""}
                aria-pressed={selections[market.id] === "b"}
                disabled={
                  busy !== null ||
                  (selectedCount >= MAX_PARLAY_LEGS &&
                    selections[market.id] === undefined)
                }
                onClick={() => chooseSelection(market.id, "b")}
              >
                {market.selectionB}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="revision-editor-actions">
        <button
          type="submit"
          className="button-accept"
          disabled={
            busy !== null ||
            selectedCount === 0 ||
            toCents(makerRisk) < 1 ||
            toCents(takerRisk) < 1 ||
            changeNote.trim().length < 3
          }
        >
          Send revision for approval
        </button>
        <button type="button" className="button-quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BetLegList({
  betId,
  legs,
}: {
  betId: string;
  legs: BetView["legs"];
}) {
  return (
    <div className="bet-leg-list">
      {legs.map((leg) => (
        <div key={`${betId}-${leg.marketRevisionId}`}>
          <span>{leg.makerSelectionLabel}</span>
          <p>{leg.marketQuestion}</p>
          <BettingDeadline value={leg.marketClosesAt} />
          <span className="revision-tag">
            Market v{leg.marketRevisionNumber}
          </span>
        </div>
      ))}
    </div>
  );
}

function BetTermsSummary({
  label,
  makerName,
  takerName,
  makerRiskCents,
  takerRiskCents,
  makerPosition,
  legs,
}: {
  label: string;
  makerName: string;
  takerName: string;
  makerRiskCents: number;
  takerRiskCents: number;
  makerPosition: ParlayPosition;
  legs: BetView["legs"];
}) {
  return (
    <div className="bet-terms-summary">
      <span>{label}</span>
      <strong>
        {money(makerRiskCents)} ↔ {money(takerRiskCents)}
      </strong>
      <small>
        {legs.length > 1
          ? `${makerName}: ${positionLabel(makerPosition)} · ${takerName}: ${positionLabel(oppositePosition(makerPosition))}`
          : `${makerName} / ${takerName}`}
      </small>
      {legs.length > 1 && (
        <p className="terms-position-rule">
          {parlayWinningRule(makerName, takerName, makerPosition)}
        </p>
      )}
      <ul>
        {legs.map((leg) => (
          <li key={`${label}-${leg.marketRevisionId}`}>
            {leg.makerSelectionLabel} · {leg.marketQuestion} · v
            {leg.marketRevisionNumber}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RevisionHistory({
  revisions,
  makerName,
  takerName,
  currentRevisionId,
}: {
  revisions: BetRevisionView[];
  makerName: string;
  takerName: string;
  currentRevisionId: string;
}) {
  return (
    <section className="revision-history" aria-label="Revision history">
      <div className="revision-history-head">
        <span>Revision history</span>
        <small>Append-only · visible to the group</small>
      </div>
      {revisions.map((revision, index) => {
        const previous = revisions[index - 1];
        return (
        <div className="revision-history-row" key={revision.id}>
          <div>
            <strong>v{revision.revisionNumber}</strong>
            <StatusBadge
              status={
                revision.id === currentRevisionId
                  ? "active"
                  : revision.status
              }
            />
          </div>
          <p>{revision.changeNote}</p>
          <small>
            Proposed by {revision.proposerName} for {revision.recipientName} ·{" "}
            {relativeTime(revision.createdAt)}
          </small>
          {previous && (
            <p className="revision-position-change">
              {makerName}: {positionLabel(previous.makerPosition)} →{" "}
              {positionLabel(revision.makerPosition)} · {takerName}:{" "}
              {positionLabel(oppositePosition(previous.makerPosition))} →{" "}
              {positionLabel(oppositePosition(revision.makerPosition))}
            </p>
          )}
          <BetTermsSummary
            label={`Revision ${revision.revisionNumber}`}
            makerName={makerName}
            takerName={takerName}
            makerRiskCents={revision.makerRiskCents}
            takerRiskCents={revision.takerRiskCents}
            makerPosition={revision.makerPosition}
            legs={revision.legs}
          />
        </div>
        );
      })}
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
  const [marketQuery, setMarketQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<MarketLedgerFilter>("all");
  const normalizedQuery = marketQuery.trim().toLocaleLowerCase();
  const filteredMarkets = filterAndSortMarkets(
    state.markets,
    marketQuery,
    statusFilter,
  );
  const statusCounts: Record<MarketStatus | "all", number> = {
    all: state.markets.length,
    open: state.markets.filter((market) => market.status === "open").length,
    resolved: state.markets.filter((market) => market.status === "resolved")
      .length,
    void: state.markets.filter((market) => market.status === "void").length,
  };
  const hasActiveLedgerFilters =
    normalizedQuery.length > 0 || statusFilter !== "all";

  function clearLedgerFilters() {
    setMarketQuery("");
    setStatusFilter("all");
  }

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
          <>
            <div className="market-ledger-tools">
              <label className="market-search">
                <span>Search all markets</span>
                <input
                  type="search"
                  value={marketQuery}
                  onChange={(event) => setMarketQuery(event.target.value)}
                  placeholder="Question, context, outcome, creator, or status"
                />
              </label>
              <div
                className="market-status-filters"
                role="group"
                aria-label="Filter markets by status"
              >
                {MARKET_STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    aria-pressed={statusFilter === filter.value}
                    className={
                      statusFilter === filter.value ? "selected" : ""
                    }
                    onClick={() => setStatusFilter(filter.value)}
                  >
                    <span>{filter.label}</span>
                    <b>{statusCounts[filter.value]}</b>
                  </button>
                ))}
              </div>
              <div className="market-ledger-result-meta" aria-live="polite">
                <span>
                  Showing {filteredMarkets.length} of {state.markets.length}
                </span>
                {hasActiveLedgerFilters && (
                  <button type="button" onClick={clearLedgerFilters}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            {filteredMarkets.length === 0 ? (
              <div className="market-ledger-empty" role="status">
                <span>NO MATCHES</span>
                <h3>No matching markets</h3>
                <p>
                  Try another phrase or include more market statuses in the
                  ledger.
                </p>
                <button type="button" onClick={clearLedgerFilters}>
                  Clear search and filters
                </button>
              </div>
            ) : (
              <div className="market-list">
                {filteredMarkets.map((market) => (
                  <MarketCard
                    key={market.id}
                    market={market}
                    busy={busy}
                    onAction={onAction}
                    onCreateOffer={onCreateOffer}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function MarketCard({
  market,
  busy,
  onAction,
  onCreateOffer,
}: {
  market: MarketView;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
  onCreateOffer: (marketId: string, selection: Selection) => void;
}) {
  const [renderedAt] = useState(Date.now);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const currentRevision =
    market.revisions.find((revision) => revision.isCurrent) ??
    market.revisions[0];
  const canEdit =
    market.createdByMe &&
    market.status === "open" &&
    new Date(market.closesAt).getTime() > renderedAt;

  return (
    <article className="market-row">
      <div className="market-state">
        <StatusBadge status={market.status} />
        <span className="revision-tag">Market v{market.revisionNumber}</span>
        <span>by {market.creatorName}</span>
      </div>
      <h3>{market.question}</h3>
      {market.description && <p>{market.description}</p>}
      <div className="market-sides">
        <span className={market.winningSelection === "a" ? "winner" : ""}>
          A · {market.selectionA}
        </span>
        <span className={market.winningSelection === "b" ? "winner" : ""}>
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

      {editing && currentRevision && (
        <MarketEditForm
          market={market}
          revision={currentRevision}
          busy={busy}
          onAction={onAction}
          onDone={() => setEditing(false)}
        />
      )}

      <div className="market-row-footer">
        <span>Closes {dateTime(market.closesAt)}</span>
        <div className="market-row-controls">
          {canEdit && (
            <button
              type="button"
              className="button-quiet"
              disabled={busy !== null}
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? "Close editor" : "Edit market"}
            </button>
          )}
          <button
            type="button"
            className="button-quiet"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((current) => !current)}
          >
            Revision history ({market.revisions.length})
          </button>
          {market.createdByMe && market.canDelete && (
            <button
              type="button"
              className="button-quiet danger"
              disabled={busy !== null}
              aria-expanded={deleteArmed}
              onClick={() => setDeleteArmed((current) => !current)}
            >
              {deleteArmed ? "Close delete panel" : "Delete market"}
            </button>
          )}
        </div>
      </div>

      {market.createdByMe && market.deletionBlocker && (
        <p className="market-delete-blocker">
          Cannot delete: {market.deletionBlocker}
        </p>
      )}

      {deleteArmed && market.canDelete && (
        <section className="market-delete-panel" aria-label="Delete market">
          <div>
            <span>PERMANENT DELETE</span>
            <strong>Remove this unused market?</strong>
          </div>
          <p>
            This removes all {market.revisions.length} market revision
            {market.revisions.length === 1 ? "" : "s"}. A minimal deletion
            receipt remains in activity history.
          </p>
          <div>
            <button
              type="button"
              className="button-dark delete-confirm"
              disabled={busy !== null}
              onClick={() =>
                void onAction(
                  {
                    type: "delete_market",
                    marketId: market.id,
                  },
                  "Unused market and its revisions permanently deleted.",
                )
              }
            >
              Permanently delete
            </button>
            <button
              type="button"
              className="button-quiet"
              onClick={() => setDeleteArmed(false)}
            >
              Keep market
            </button>
          </div>
        </section>
      )}

      {currentRevision?.canResolve && (
        <MarketRevisionResolveActions
          marketId={market.id}
          revision={currentRevision}
          busy={busy}
          onAction={onAction}
        />
      )}

      {showHistory && (
        <MarketRevisionHistory
          market={market}
          busy={busy}
          onAction={onAction}
        />
      )}
    </article>
  );
}

function MarketEditForm({
  market,
  revision,
  busy,
  onAction,
  onDone,
}: {
  market: MarketView;
  revision: MarketRevisionView;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
  onDone: () => void;
}) {
  const [question, setQuestion] = useState(revision.question);
  const [description, setDescription] = useState(revision.description);
  const [selectionA, setSelectionA] = useState(revision.selectionA);
  const [selectionB, setSelectionB] = useState(revision.selectionB);
  const [closesAt, setClosesAt] = useState(
    toDateTimeInput(revision.closesAt),
  );
  const [changeNote, setChangeNote] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onAction(
      {
        type: "edit_market",
        marketId: market.id,
        baseRevisionId: revision.id,
        question,
        description,
        selectionA,
        selectionB,
        closesAt: new Date(closesAt).toISOString(),
        changeNote,
      },
      "New market revision published. Existing offers and bets kept their original terms.",
    );
    onDone();
  }

  return (
    <form className="market-edit-form" onSubmit={submit}>
      <div className="revision-editor-head">
        <div>
          <span>EDIT MARKET</span>
          <h4>Create version {revision.revisionNumber + 1}</h4>
        </div>
        <span>v{revision.revisionNumber} stays public</span>
      </div>
      <p>
        This creates a new version. Existing offers and matched bets keep the
        exact revision they already reference.
      </p>
      <label>
        <span>The question</span>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
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
      <label>
        <span>Change note</span>
        <textarea
          value={changeNote}
          onChange={(event) => setChangeNote(event.target.value)}
          placeholder="Explain the correction so everyone can audit it."
          minLength={3}
          maxLength={200}
          required
        />
      </label>
      <div className="revision-editor-actions">
        <button
          type="submit"
          className="button-accept"
          disabled={
            busy !== null ||
            question.trim().length < 5 ||
            changeNote.trim().length < 3
          }
        >
          Publish new revision
        </button>
        <button type="button" className="button-quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MarketRevisionHistory({
  market,
  busy,
  onAction,
}: {
  market: MarketView;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
}) {
  return (
    <section className="revision-history market-revision-history">
      <div className="revision-history-head">
        <span>Revision history</span>
        <small>Every version resolves independently</small>
      </div>
      {market.revisions.map((revision, index) => {
        const previous = market.revisions[index + 1];
        return (
          <div className="revision-history-row" key={revision.id}>
            <div>
              <strong>v{revision.revisionNumber}</strong>
              <StatusBadge status={revision.status} />
              {revision.isCurrent && (
                <span className="revision-tag">CURRENT</span>
              )}
            </div>
            <p>{revision.changeNote}</p>
            <small>
              {revision.editorName} · {relativeTime(revision.createdAt)}
            </small>
            <MarketRevisionDiff revision={revision} previous={previous} />
            {revision.canResolve && !revision.isCurrent && (
              <MarketRevisionResolveActions
                marketId={market.id}
                revision={revision}
                busy={busy}
                onAction={onAction}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}

function MarketRevisionDiff({
  revision,
  previous,
}: {
  revision: MarketRevisionView;
  previous?: MarketRevisionView;
}) {
  const changes = previous
    ? [
        ["Question", previous.question, revision.question],
        ["Context", previous.description || "—", revision.description || "—"],
        ["Side A", previous.selectionA, revision.selectionA],
        ["Side B", previous.selectionB, revision.selectionB],
        [
          "Closes",
          dateTime(previous.closesAt),
          dateTime(revision.closesAt),
        ],
      ].filter(([, before, after]) => before !== after)
    : [];

  if (!previous) {
    return (
      <div className="market-revision-snapshot">
        <strong>{revision.question}</strong>
        <span>
          {revision.selectionA} / {revision.selectionB}
        </span>
        <BettingDeadline value={revision.closesAt} />
      </div>
    );
  }

  return (
    <dl className="revision-diff-list">
      {changes.map(([label, before, after]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            <del>{before}</del>
            <span aria-hidden="true">→</span>
            <ins>{after}</ins>
          </dd>
        </div>
      ))}
      {changes.length === 0 && (
        <div>
          <dt>Terms</dt>
          <dd>No visible field changed.</dd>
        </div>
      )}
    </dl>
  );
}

function MarketRevisionResolveActions({
  marketId,
  revision,
  busy,
  onAction,
}: {
  marketId: string;
  revision: MarketRevisionView;
  busy: string | null;
  onAction: (action: AppAction, message: string) => Promise<void>;
}) {
  return (
    <div className="resolve-actions revision-resolve-actions">
      <span>Resolve market v{revision.revisionNumber}</span>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() =>
          void onAction(
            {
              type: "resolve_market",
              marketId,
              marketRevisionId: revision.id,
              result: "a",
            },
            `${revision.selectionA} recorded as the winner for market v${revision.revisionNumber}.`,
          )
        }
      >
        {revision.selectionA} won
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() =>
          void onAction(
            {
              type: "resolve_market",
              marketId,
              marketRevisionId: revision.id,
              result: "b",
            },
            `${revision.selectionB} recorded as the winner for market v${revision.revisionNumber}.`,
          )
        }
      >
        {revision.selectionB} won
      </button>
      <button
        type="button"
        className="danger"
        disabled={busy !== null}
        onClick={() =>
          void onAction(
            {
              type: "resolve_market",
              marketId,
              marketRevisionId: revision.id,
              result: "void",
            },
            `Market v${revision.revisionNumber} voided.`,
          )
        }
      >
        Void
      </button>
    </div>
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

function BettingDeadline({ value }: { value: string }) {
  return (
    <time className="betting-deadline" dateTime={value}>
      Closes {dateTime(value)}
    </time>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status === "void" ? "voided" : status.replaceAll("_", " ");
  return (
    <span className={`status-badge status-${status.replaceAll("_", "-")}`}>
      {label}
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

function oppositePosition(position: ParlayPosition): ParlayPosition {
  return position === "back" ? "fade" : "back";
}

function positionLabel(position: ParlayPosition): "Back" | "Fade" {
  return position === "back" ? "Back" : "Fade";
}

function parlayRoleSentence(
  bet: Pick<BetView, "makerName" | "takerName" | "makerPosition">,
): string {
  return bet.makerPosition === "back"
    ? `${bet.makerName} backs it; ${bet.takerName} fades it.`
    : `${bet.makerName} fades it; ${bet.takerName} backs it.`;
}

function parlayWinningRule(
  makerName: string,
  takerName: string,
  makerPosition: ParlayPosition,
): string {
  return makerPosition === "back"
    ? `${makerName} wins if every non-void pick hits; ${takerName} wins if any pick misses.`
    : `${makerName} wins if any pick misses; ${takerName} wins if every non-void pick hits.`;
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
  }).format(timestampDate(value));
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - timestampDate(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timestampDate(value: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(normalized);
}

function defaultCloseTime(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toDateTimeInput(value: string): string {
  const date = new Date(value);
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

function apiErrorCode(payload: unknown): string | null {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "code" in payload.error &&
    typeof payload.error.code === "string"
  ) {
    return payload.error.code;
  }
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
