import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { readState, rememberCard } from "./offline.js";
import CardControl from "./CardControl.jsx";

const euros = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

const storeLogos = {
  Continente: "/stores/continente.png",
  Galp: "/stores/galp.png",
  Wells: "/stores/wells.svg",
  "Pizza Hut": "/stores/pizza-hut.png",
  "Taco Bell": "/stores/taco-bell.png",
  TacoBell: "/stores/taco-bell.png",
  KFC: "/stores/kfc.png",
  "Pans & Company": "/stores/pans-company.png",
  "Pans&Company": "/stores/pans-company.png",
};

const statuses = {
  available: "Disponíveis",
  upcoming: "Em breve",
  expired: "Expirados",
  removed: "Retirados",
  used: "Utilizados",
};
const kinds = {
  new: "Novo cupão",
  changed: "Cupão alterado",
  returned: "Disponível novamente",
  removed: "Retirado",
  expired: "Expirado",
};
const date = (value) =>
  new Intl.DateTimeFormat("pt-PT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Lisbon",
  }).format(new Date(value + "T12:00:00Z"));
const instant = (value) =>
  value
    ? new Intl.DateTimeFormat("pt-PT", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Lisbon",
      }).format(new Date(value))
    : "Ainda não verificada";
function Icon({ name }) {
  const paths = {
    arrow: "M5 12h14 M13 6l6 6-6 6",
    ticket:
      "M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4V5 M15 5v3 M15 11v2 M15 16v3",
  };
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
function StoreSelector({ stores, coupons, selected, account, onSelect }) {
  if (!stores.length) return null;
  return (
    <div className="store-selector" role="group" aria-label="Filtrar por loja">
      {stores.map((store) => {
        const hasNew = coupons.some(
          (c) => c.brand === store && c.isNew && c.present &&
            ["available", "upcoming"].includes(c.status) &&
            (account === "all" || c.accountId === account),
        );
        return (
          <button
            key={store}
            className="store-button"
            aria-pressed={selected === store}
            aria-label={hasNew ? `${store}: novos cupões` : store}
            onClick={() => onSelect(store)}
          >
            <span className="store-circle" aria-hidden="true">
              {Object.hasOwn(storeLogos, store) ? (
                <img src={storeLogos[store]} alt="" />
              ) : (
                <span>{store.split(/\s+/).map((word) => word[0]).slice(0, 2).join("")}</span>
              )}
              {hasNew && <span className="store-new" />}
            </span>
            <span>{store}</span>
          </button>
        );
      })}
    </div>
  );
}
function CouponDetails({ coupon }) {
  return (
    <details>
      <summary>{coupon.imageUrl ? "Condições e imagem original" : "Condições"}</summary>
      <div className="details-body">
        <div>
          <p>{coupon.description}</p>
          <dl>
            <dt>Código</dt>
            <dd>{coupon.code}</dd>
            <dt>Compra mínima</dt>
            <dd>{coupon.minimumPurchase || "Não indicada separadamente"}</dd>
            <dt>Ativação / utilização</dt>
            <dd>Não indicado na origem</dd>
            <dt>Primeira deteção</dt>
            <dd>{instant(coupon.firstSeen)}</dd>
          </dl>
        </div>
        {coupon.imageUrl && <img
          src={coupon.imageUrl}
          alt={`Imagem do desconto ${coupon.discount || "disponível no portal"}`}
          loading="lazy"
          referrerPolicy="no-referrer"
        />}
      </div>
    </details>
  );
}
function Comparison({ coupons, accounts }) {
  const groups = new Map();
  for (const c of coupons.filter(
    (c) => c.present && !["expired", "used"].includes(c.status),
  )) {
    const key = [c.brand, c.description, c.startDate, c.endDate].join("|");
    if (!groups.has(key)) groups.set(key, { coupon: c, accounts: {} });
    const group = groups.get(key);
    (group.accounts[c.accountId] ??= []).push(c);
  }
  return (
    <div className="comparison">
      <div className="compare-row compare-heading">
        <span>Oferta e validade</span>
        {accounts.map((a) => (
          <span key={a.id}>{a.name}</span>
        ))}
      </div>
      {[...groups.values()]
        .sort((a, b) => a.coupon.endDate.localeCompare(b.coupon.endDate))
        .map((g) => (
          <div className="compare-row" key={g.coupon.key}>
            <div>
              <span className="brand">{g.coupon.brand}</span>
              <h3>{g.coupon.title.toLocaleLowerCase("pt-PT")}</h3>
              <small>
                {date(g.coupon.startDate)} — {date(g.coupon.endDate)}
              </small>
            </div>
            {accounts.map((a) => (
              <div className="compare-value" key={a.id}>
                <span className="mobile-account">{a.name}</span>
                {g.accounts[a.id]?.map((c) => (
                  <span key={c.key}>
                    <strong>{c.discount || "Ver imagem"}</strong>
                    <small>
                      {c.status === "upcoming" ? "Em breve" : "Disponível"}
                    </small>
                  </span>
                )) || (
                  <small>
                    {a.last_success ? "Sem esta oferta" : "Por verificar"}
                  </small>
                )}
              </div>
            ))}
          </div>
        ))}
      {!groups.size && (
        <div className="empty">
          {coupons.length
            ? "Não existem ofertas atuais desta loja para comparar."
            : "As ofertas aparecerão aqui após a primeira verificação."}
        </div>
      )}
      <p className="fine-print">
        A comparação associa ofertas com as mesmas condições e datas. Consulte a
        imagem original antes de comprar.
      </p>
    </div>
  );
}
export default function App() {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [activating, setActivating] = useState(null);
  const [tab, setTab] = useState("coupons"),
    [store, setStore] = useState("Continente"),
    [account, setAccount] = useState("all"),
    [status, setStatus] = useState("current"),
    [expiry, setExpiry] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let loading = false;
    const load = async () => {
      if (loading) return;
      clearTimeout(timer);
      loading = true;
      try {
        const updated = await readState(controller.signal);
        setData((current) => current?.serverNow > updated.serverNow && !updated.offline ? current : updated);
        setError("");
      } catch (e) {
        if (e.name !== "AbortError") setError(e.message);
      } finally {
        loading = false;
        if (!controller.signal.aborted && !document.hidden) timer = setTimeout(load, 15000);
      }
    };
    const visibility = () => {
      if (document.hidden) clearTimeout(timer);
      else load();
    };
    load();
    window.addEventListener("online", load);
    window.addEventListener("offline", load);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("online", load);
      window.removeEventListener("offline", load);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  async function useCard(accountId) {
    setActivating(accountId);
    setError("");
    try {
      const response = await fetch(`/api/cards/${accountId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error === "BUSY"
        ? "Já existe uma operação em curso. Aguarde e tente novamente."
        : result.error === "AUTH_REQUIRED"
          ? "Inicie sessão nesta conta na app Cartão Continente e tente novamente."
          : "Não foi possível confirmar a ativação do cartão. Consulte o estado da conta e tente novamente.");
      rememberCard(accountId, result.card, result.serverNow);
      setData((current) => ({
        ...current, serverNow: result.serverNow, clockOffsetMs: result.serverNow - Date.now(),
        offline: false, running: false,
        accounts: current.accounts.map((a) => a.id === accountId ? { ...a, card: result.card } : a),
      }));
    } catch (e) {
      setError(e instanceof TypeError
        ? "Ligação interrompida. Volte a ligar ao Mac para confirmar se o cartão ficou ativo."
        : e.message);
    } finally { setActivating(null); }
  }
  async function check() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "respond-async" },
        body: JSON.stringify({ accountId: account }),
        signal: AbortSignal.timeout(10000),
      });
      const result = await r.json();
      if (!r.ok)
        throw Error(
          r.status === 409
            ? "Já existe uma verificação ou início de sessão em curso."
            : "Não foi possível iniciar a verificação. Tente novamente.",
        );
      setData((current) => current?.serverNow > result.serverNow ? current
        : { ...current, running: true, manualCheck: result.check, serverNow: result.serverNow });
    } catch (e) {
      setError(["TypeError", "TimeoutError", "AbortError", "SyntaxError"].includes(e.name)
        ? "Ligação interrompida. Volte a ligar ao Mac para confirmar o estado da verificação."
        : e.message);
    } finally {
      setBusy(false);
    }
  }
  const manualCheck = data?.manualCheck;
  const checkFailed = !data?.offline && !busy && manualCheck &&
    (manualCheck.status === "failed" || manualCheck.results?.some((result) => !result.ok));
  const errorMessage = error || (checkFailed
    ? manualCheck.error === "CHECK_INTERRUPTED"
      ? "A verificação foi interrompida no Mac. Os últimos cupões confirmados foram preservados. Tente novamente."
      : manualCheck.status === "failed"
        ? "Não foi possível concluir a verificação. Os últimos cupões confirmados foram preservados. Tente novamente."
        : "Uma conta não pôde ser verificada. Os últimos cupões confirmados foram preservados. Consulte o estado da conta."
    : "");
  const notice = !busy && !activating && !errorMessage && manualCheck
    ? data.offline
      ? "Volte a ligar ao Mac para confirmar o estado da última verificação."
      : manualCheck.status === "running"
        ? "A verificar cupões no Mac. Pode fechar esta página e voltar mais tarde."
        : `Verificação concluída em ${instant(manualCheck.completedAt)}. Os cupões estão atualizados.`
    : "";
  const accountName = (id) =>
    data?.accounts.find((a) => a.id === id)?.name || id;
  const coupons = data?.coupons || [];
  const stores = [...new Set([
    ...Object.keys(storeLogos),
    ...coupons.map((c) => c.brand),
  ])].filter((brand) => coupons.some((c) => c.brand === brand));
  const selectedStore = stores.includes(store) ? store : stores[0];
  const storeCoupons = coupons.filter((c) => c.brand === selectedStore);
  const accountCoupons = storeCoupons.filter(
    (c) => account === "all" || c.accountId === account,
  );
  const filtered = accountCoupons
    .filter(
      (c) =>
        (status === "all" ||
          (status === "current" &&
            ["available", "upcoming"].includes(c.status)) ||
          (status === "new" && c.isNew && c.present) ||
          (status === "expiring" && c.expiring) ||
          c.status === status) &&
        (!expiry || c.endDate <= expiry),
    )
    .sort(
      (a, b) =>
        a.endDate.localeCompare(b.endDate) || a.title.localeCompare(b.title),
    );
  const historyEvents = (data?.events || []).filter(
    (e) => e.payload.brand === selectedStore &&
      (account === "all" || e.account_id === account),
  );
  const countedCoupons = tab === "compare" ? storeCoupons : accountCoupons;
  const available = countedCoupons.filter(
    (c) => c.status === "available",
  ).length;
  const upcoming = countedCoupons.filter(
    (c) => c.status === "upcoming",
  ).length;
  const running = busy || !!activating || data?.running;
  return (
    <>
      <header className="topbar">
        <a className="logo" href="/" aria-label="CC Cupões, página inicial">
          <Icon name="ticket" />
          <span>
            CC <b>Cupões</b>
          </span>
        </a>
        <span className="local-label">{data?.offline ? "Sem ligação ao Mac" : "Guardados no seu Mac"}</span>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <h1>
              Os seus cupões,
              <br />
              <span>em dia.</span>
            </h1>
          </div>
          <div className="check-control">
            <button
              className="primary"
              onClick={check}
              disabled={!data || running || data.offline}
            >
              <RefreshCw size={20} strokeWidth={1.7} aria-hidden="true" />
              {activating ? "Ativação de cartão em curso" : running ? "Operação em curso" : "Verificar cupões"}
            </button>
            <small>
              {account === "all"
                ? "Verificar todas as contas"
                : accountName(account)}{" "}
              · Europe/Lisbon
            </small>
          </div>
        </div>
        {errorMessage && (
          <div role="alert" className="message error">
            {errorMessage}
            {!data && (
              <button onClick={() => location.reload()}>
                Tentar novamente
              </button>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="message success">
            {notice}
          </p>
        )}
        {data && (
          <p role="status" className={data.offline || !data.saved ? "message offline" : "sync-status"}>
            {data.offline
              ? `Sem ligação ao Mac. A mostrar a cópia guardada em ${instant(data.savedAt)}. Os cupões podem ter mudado.`
              : data.saved
                ? `Última sincronização com o Mac: ${instant(data.savedAt)}.`
                : "Não foi possível guardar os cupões neste dispositivo. O acesso sem ligação não está disponível."}
          </p>
        )}
        {!data && !error && (
          <p role="status" className="loading">
            A carregar os seus cupões…
          </p>
        )}
        {data && (
          <>
            <section className="accounts" aria-label="Estado das contas">
              {data.accounts.map((a) => (
                <div className="account" key={a.id}>
                  <div className="account-title">
                    <h2>{a.name}</h2>
                    <span
                      className={`connection ${a.auth === "ready" && !a.error ? "connected" : "attention"}`}
                    >
                      {a.error === "MANUAL_VERIFICATION"
                        ? "Verificação manual"
                        : a.error
                          ? a.auth === "required"
                            ? "Iniciar sessão"
                            : "Verificação falhou"
                          : a.auth === "ready"
                            ? "Sessão guardada"
                            : "Por ligar"}
                    </span>
                  </div>
                  <p className="account-balance">
                    Saldo em cartão{" "}
                    <strong>{Number.isSafeInteger(a.balance?.cents)
                      ? euros.format(a.balance.cents / 100) : "Por verificar"}</strong>
                  </p>
                  {a.balance?.checkedAt && <p>Saldo verificado: <strong>{instant(a.balance.checkedAt)}</strong></p>}
                  {!!a.balance?.error && <p className="account-error">
                    {a.balance.checkedAt
                      ? "Não foi possível atualizar o saldo. O valor anterior foi mantido."
                      : "Não foi possível ler o saldo. Tente verificar esta conta novamente."}
                  </p>}
                  <p>
                    Última verificação:{" "}
                    <strong>{instant(a.last_success)}</strong>
                  </p>
                  {a.source === "android" && <CardControl
                    account={a} offline={data.offline} running={running}
                    activating={activating === a.id} clockOffsetMs={data.clockOffsetMs}
                    onActivate={useCard}
                  />}
                  {a.error && (
                    <p className="account-error">
                      {a.error === "MANUAL_VERIFICATION"
                        ? "O portal pediu uma verificação do navegador. A lista completa ainda não foi confirmada."
                        : a.auth === "required"
                          ? "É necessário concluir o login manual."
                          : "A última tentativa falhou. Os dados anteriores foram mantidos."}
                    </p>
                  )}
                  {(a.auth !== "ready" || a.error) && (
                    <details className="login-help">
                      <summary>
                        {a.error === "MANUAL_VERIFICATION"
                          ? "Como verificar o navegador"
                          : "Como iniciar sessão"}
                      </summary>
                      <p>No Terminal, dentro desta pasta:</p>
                      <code>npm run login -- {a.id}</code>
                      <p>
                        {a.source === "android"
                          ? "Inicie sessão na app Cartão Continente do emulador. Depois, volte a verificar esta conta."
                          : a.error === "MANUAL_VERIFICATION"
                          ? "Conclua qualquer verificação apresentada pelo site. Se a página continuar em branco, contacte o apoio Cartão Continente. Repetir o SMS pode não resolver este bloqueio."
                          : "Conclua o SMS apenas no site. A janela fecha ao terminar."}
                      </p>
                    </details>
                  )}
                </div>
              ))}
            </section>
            <StoreSelector
              stores={stores}
              coupons={coupons}
              selected={selectedStore}
              account={tab === "compare" ? "all" : account}
              onSelect={setStore}
            />
            <div className="workspace-heading">
              <nav aria-label="Vistas dos cupões">
                {[
                  ["coupons", "Cupões"],
                  ["compare", "Comparar contas"],
                  ["history", "Histórico"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={tab === id ? "tab selected" : "tab"}
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <p>
                {available} {available === 1 ? "disponível" : "disponíveis"}
                <span>·</span> {upcoming} em breve
              </p>
            </div>
            <div className="filters">
              <label>
                Conta
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="all">Todas as contas</option>
                  {data.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              {tab === "coupons" && (
                <>
                  <label>
                    Estado
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="current">Atuais e em breve</option>
                      <option value="new">Novos nas últimas 48h</option>
                      <option value="expiring">Expiram em 48h</option>
                      {Object.entries(statuses).map(([key, label]) => (
                        <option value={key} key={key}>
                          {label}
                        </option>
                      ))}
                      <option value="all">Todos, incluindo histórico</option>
                    </select>
                  </label>
                  <label>
                    Expira até
                    <input
                      type="date"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                    />
                  </label>
                  {expiry && (
                    <button
                      className="text-button"
                      onClick={() => setExpiry("")}
                    >
                      Limpar data
                    </button>
                  )}
                </>
              )}
              {tab === "compare" && (
                <p>
                  O filtro Conta define a próxima verificação. A comparação inclui todas as contas.
                </p>
              )}
            </div>
            {tab === "coupons" && (
              <section aria-label="Cupões">
                <div className="list-caption">
                  <h2>
                    {selectedStore && `${selectedStore} · `}
                    {filtered.length}{" "}
                    {filtered.length === 1 ? "cupão" : "cupões"}
                  </h2>
                  <span>Por data de validade</span>
                </div>
                <div className="coupon-list">
                  {filtered.map((c) => (
                    <article
                      className={`coupon ${c.expiring ? "expiring" : ""}`}
                      key={c.accountId + c.key}
                    >
                      <div className="discount">
                        <strong>{c.discount || "Ver imagem"}</strong>
                        <span>
                          {c.discount ? "em cartão" : "Valor não identificado"}
                        </span>
                      </div>
                      <div className="offer">
                        <div className="offer-labels">
                          <span className="brand">{c.brand}</span>
                          <span>{accountName(c.accountId)}</span>
                          {c.isNew && c.present && (
                            <span className="badge new">Novo</span>
                          )}
                          {c.expiring && (
                            <span className="badge urgent">Expira em 48h</span>
                          )}
                        </div>
                        <h3>{c.title.toLocaleLowerCase("pt-PT")}</h3>
                        <CouponDetails coupon={c} />
                      </div>
                      <div className="validity">
                        <span className="status-label">
                          {statuses[c.status]}
                        </span>
                        <strong>Até {date(c.endDate)}</strong>
                        <small>Desde {date(c.startDate)}</small>
                      </div>
                    </article>
                  ))}
                </div>
                {!filtered.length && (
                  <div className="empty">
                    <h3>
                      {data.coupons.length
                        ? "Nenhum cupão com estes filtros"
                        : "Ainda não existem cupões confirmados"}
                    </h3>
                    <p>
                      {data.coupons.length
                        ? "Altere a loja, a conta, o estado ou a data."
                        : "Inicie sessão e execute uma verificação para começar."}
                    </p>
                  </div>
                )}
              </section>
            )}
            {tab === "compare" && (
              <Comparison coupons={storeCoupons} accounts={data.accounts} />
            )}
            {tab === "history" && (
              <section aria-label="Histórico de alterações" className="history">
                <h2>Últimas alterações{selectedStore && ` · ${selectedStore}`}</h2>
                <p className="fine-print">
                  As 200 alterações mais recentes. O histórico completo
                  permanece na base de dados local.
                </p>
                {historyEvents.map((e) => (
                  <article key={e.id}>
                    <time>{instant(e.at)}</time>
                    <div>
                      <div className="offer-labels">
                        <span className="brand">{kinds[e.kind]}</span>
                        <span>{accountName(e.account_id)}</span>
                      </div>
                      <h3>
                        {e.payload.description.toLocaleLowerCase("pt-PT")}
                      </h3>
                      <p>
                        {e.payload.brand} ·{" "}
                        {e.payload.discount || "Desconto na imagem"} · até{" "}
                        {date(e.payload.endDate)}
                      </p>
                      {e.previous && (
                        <details>
                          <summary>Ver alteração</summary>
                          <dl>
                            <dt>Antes</dt>
                            <dd>
                              {e.previous.discount || "Ver imagem"} ·{" "}
                              {e.previous.description} ·{" "}
                              {date(e.previous.startDate)} —{" "}
                              {date(e.previous.endDate)}
                            </dd>
                            <dt>Depois</dt>
                            <dd>
                              {e.payload.discount || "Ver imagem"} ·{" "}
                              {e.payload.description} ·{" "}
                              {date(e.payload.startDate)} —{" "}
                              {date(e.payload.endDate)}
                            </dd>
                          </dl>
                        </details>
                      )}
                    </div>
                  </article>
                ))}
                {!historyEvents.length && (
                  <p className="empty">
                    Ainda não existem alterações registadas para esta seleção.
                  </p>
                )}
              </section>
            )}
            <footer>
              <p>
                O portal pode não mostrar os cupões exclusivos da app. Ativação
                e utilização só são indicadas quando confirmadas.
              </p>
              <div>
                <span>
                  Telegram:{" "}
                  {data.telegramConfigured
                    ? "configurado"
                    : "por configurar em .env"}
                </span>
                <span>Horário definido: {data.dailyTime} · Lisboa</span>
              </div>
              {data.notifications.some((n) =>
                ["uncertain", "failed"].includes(n.state),
              ) && (
                <p className="account-error">
                  Há notificações com entrega por confirmar ou falhada. Consulte
                  a tabela outbox na base de dados local.
                </p>
              )}
            </footer>
          </>
        )}
      </main>
    </>
  );
}
