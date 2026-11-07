import { CreditCard } from "lucide-react";
import { useEffect, useState } from "react";

export default function CardControl({ account, offline, running, activating, clockOffsetMs = 0, onActivate }) {
  const expiresAt = account.card?.expiresAt || 0;
  const [now, setNow] = useState(Date.now);
  const [imageError, setImageError] = useState(false);
  const seconds = Math.max(0, Math.floor((expiresAt - now - clockOffsetMs) / 1000));
  const active = seconds > 0;
  useEffect(() => {
    let timer;
    const tick = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      if (!document.hidden && expiresAt > current + clockOffsetMs)
        timer = setTimeout(tick, 1000);
    };
    tick();
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [expiresAt, clockOffsetMs]);
  useEffect(() => setImageError(false), [expiresAt, offline]);

  return <div className="card-control">
    {active ? <div className="card-status">
        <span className="connected">Cartão ativo</span>
        <strong role="timer" aria-label={`Tempo restante do cartão de ${account.name}`}>
          {`${Math.floor(seconds / 60)}`.padStart(2, "0")}:{`${seconds % 60}`.padStart(2, "0")}
        </strong>
      </div> : <button className="primary" onClick={() => onActivate(account.id)}
        disabled={running || offline || account.auth !== "ready"}
        aria-busy={!!activating}
        aria-label={`Usar cartão de ${account.name}`}>
        <CreditCard size={18} strokeWidth={1.7} aria-hidden="true" />
        <span className="button-label">{activating ? "A ativar cartão…" : "Usar cartão"}</span>
      </button>}
    <p role="status" aria-atomic="true">{activating
      ? `${account.name}: a obter autorização na app Cartão Continente. Aguarde…`
      : active ? `${account.name}: cartão ativo. Apresente este código na caixa para descontar saldo.`
        : expiresAt ? `${account.name}: autorização terminada. Ative o cartão novamente para usar saldo.`
          : "Ative durante 10 minutos para usar saldo em loja."}</p>
    {active && <>
      {imageError
        ? <p role="alert">Não foi possível carregar o código. Volte a ligar ao Mac e reabra a app.</p>
        : <img className="card-code"
            src={`/api/cards/${account.id}/image?expiresAt=${expiresAt}`}
            alt={`Código de autorização e código de barras de ${account.name}`}
            onError={() => setImageError(true)} />}
      {offline && <p>Sem ligação. O tempo indica a última autorização confirmada.</p>}
    </>}
  </div>;
}
