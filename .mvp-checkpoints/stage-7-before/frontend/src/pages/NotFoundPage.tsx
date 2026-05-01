import { Compass, Home, LifeBuoy, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { Card } from "@/components/ui/Card";

function NotFoundPage() {
  return (
    <main className="page-shell stack-lg">
      <Card className="hero-card empty-state stack-lg">
        <div className="brand-mark is-hero">404</div>

        <div className="stack-sm">
          <h1 className="title-reset">Страница не найдена</h1>
          <p className="muted">
            Похоже, ссылка устарела или этот маршрут больше не используется в текущей версии MTN.
          </p>
        </div>

        <div className="cards-grid">
          <Card className="span-4 stack-sm">
            <Home size={18} />
            <strong>На главную</strong>
            <p className="muted">Вернитесь в стартовую точку и заново выберите нужный сценарий.</p>
            <Link className="ui-button is-primary is-md" to="/">
              Открыть главную
            </Link>
          </Card>

          <Card className="span-4 stack-sm">
            <Compass size={18} />
            <strong>Ко входу</strong>
            <p className="muted">Продолжите через авторизацию и перейдите в личный кабинет или админ-зону.</p>
            <Link className="ui-button is-secondary is-md" to="/login">
              Перейти ко входу
            </Link>
          </Card>

          <Card className="span-4 stack-sm">
            <LifeBuoy size={18} />
            <strong>Нужна помощь?</strong>
            <p className="muted">Если ссылка должна была работать, возможно, приложение ещё не обновилось.</p>
            <Link className="ui-button is-secondary is-md" to="/support">
              Открыть поддержку
            </Link>
          </Card>
        </div>

        <div className="inline-actions justify-center">
          <ShieldAlert size={16} />
          <span className="muted">Ошибка не влияет на данные аккаунта и не завершает текущую сессию.</span>
        </div>
      </Card>
    </main>
  );
}

export default NotFoundPage;
