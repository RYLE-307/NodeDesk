import { useEffect, useState } from 'react';

const labels = {
  ru: { navigation: 'Навигация', connections: 'Подключения', settings: 'Настройки', empty: 'Каталог пока пуст', workspace: 'Рабочая область', tabs: 'Вкладки сессий', stage: 'Основа проекта · подключения ещё не реализованы' },
  en: { navigation: 'Navigation', connections: 'Connections', settings: 'Settings', empty: 'No connections yet', workspace: 'Workspace', tabs: 'Session tabs', stage: 'Project scaffold · connections are not implemented yet' },
};

export default function App() {
  const [expanded, setExpanded] = useState(true);
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  const t = labels[language];
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return <div className={`app ${expanded ? '' : 'collapsed'}`}>
    <aside aria-label={t.navigation}>
      <header><span className="logo">N</span>{expanded && <strong>NodeDesk</strong>}
        <button aria-label={t.navigation} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>☰</button>
      </header>
      <div className="catalog"><span title={t.connections}>◈</span>{expanded && <><span>{t.connections}</span><p>{t.empty}</p></>}</div>
      <footer><button aria-label="Русский / English" onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}>{language.toUpperCase()}</button></footer>
    </aside>
    <main aria-label={t.workspace}>
      <div className="tabs" aria-label={t.tabs} />
      <div className="workspace" />
      <div className="status">{t.stage}</div>
    </main>
  </div>;
}
