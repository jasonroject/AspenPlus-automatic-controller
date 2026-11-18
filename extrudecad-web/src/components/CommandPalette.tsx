import { t } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Search, X, ArrowUpDown, CornerDownLeft } from 'lucide-react';

export interface CadCommand {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

export function CommandPalette({ open, onClose, commands }: {
  open: boolean; onClose: () => void; commands: CadCommand[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = commands.filter((command) => `${command.label} ${t(command.label)} ${command.group} ${t(command.group)} ${command.keywords ?? ''} ${command.shortcut ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      setQuery('');
      setActiveIndex(0);
      if (!dialog.open) dialog.showModal();
      inputRef.current?.focus();
    } else if (dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    dialogRef.current?.querySelector(`[data-command-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const execute = (command?: CadCommand) => {
    if (!command || command.disabled) return;
    onClose();
    command.run();
  };

  return <dialog ref={dialogRef} className="command-dialog" aria-labelledby="command-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="command-content" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target === inputRef.current) {
        event.preventDefault();
        setActiveIndex((index) => filtered.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0);
      } else if (event.key === 'Enter' && event.target === inputRef.current) {
        event.preventDefault();
        execute(filtered[activeIndex]);
      }
    }}>
      <div className="command-search"><Search size={19} /><label id="command-title" className="sr-only" htmlFor="cad-command-search">{t("搜索命令")}</label><input ref={inputRef} id="cad-command-search" aria-label={t("搜索命令")} placeholder={t("搜索命令、工具或快捷键…")} value={query} autoComplete="off" onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} /><button className="icon-button" aria-label={t("关闭命令搜索")} onClick={onClose}><X size={17} /></button></div>
      <div className="command-results" role="list" aria-label={t("可用命令")}>
        {t(filtered.map((command, index) => <button key={command.id} type="button" data-command-index={index} className={`command-result ${index === activeIndex ? 'is-active' : ''}`} disabled={command.disabled} onFocus={() => setActiveIndex(index)} onMouseEnter={() => setActiveIndex(index)} onClick={() => execute(command)}>
          <span><small>{t(command.group)}</small><strong>{t(command.label)}</strong></span>{t(command.shortcut && <kbd>{t(command.shortcut)}</kbd>)}
        </button>))}
        {t(!filtered.length && <p className="command-empty">{t("没有匹配命令。试试“测量”“移动”或“创建”。")}</p>)}
      </div>
      <div className="command-footer"><span><ArrowUpDown size={12} />{" " + t("选择")}</span><span><CornerDownLeft size={12} />{" " + t("执行")}</span><span>{t("Esc 关闭")}</span></div>
    </div>
  </dialog>;
}
