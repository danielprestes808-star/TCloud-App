import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, Key, Lock, ArrowRight, ShieldCheck, Sun, Moon, AlertTriangle, UserRound, AtSign } from "lucide-react";
import { useTheme } from '../../context/ThemeContext';
import { QRCodeSVG } from 'qrcode.react';
import { getLocalProfile, saveLocalProfile } from '../../services/tcloudProfile';
import { registerTCloudAccount } from '../../services/tcloudAccount';

import { useTranslation } from "react-i18next";

type Step = "profile" | "phone" | "code" | "password";

function AuthThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    return (
        <button
            onClick={toggleTheme}
            className="quiet-control absolute end-4 top-[calc(1rem+env(safe-area-inset-top,24px))] z-10 flex h-9 w-9 items-center justify-center border border-app-border bg-app-surface-raised text-app-text-secondary shadow-[var(--shadow-raised)] hover:text-app-text"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
            {theme === 'dark' ? (
                <Sun className="h-4 w-4" />
            ) : (
                <Moon className="h-4 w-4" />
            )}
        </button>
    );
}
export function AuthWizard({ onLogin }: { onLogin: () => void }) {
    const { t } = useTranslation();
    const isBrowser = typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window);

    if (isBrowser) {
        return (
            <div className="auth-gradient flex h-full items-center justify-center p-6 text-center text-app-text">
              <div className="quiet-raised max-w-md p-6">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-container bg-app-danger/10">
                    <ShieldCheck className="h-6 w-6 text-app-danger" />
                </div>
                <h1 className="text-app-title font-semibold text-app-text">{t('auth.desktop_required')}</h1>
                <p className="mx-auto mt-2 max-w-sm text-ui leading-relaxed text-app-text-secondary">
                    {t('auth.desktop_required_desc')}
                </p>
                <div className="mt-5 rounded-control border border-app-border bg-app-surface-sunken/40 p-3 text-metadata text-app-text-secondary">
                    {t('auth.open_window_prompt')}
                </div>
              </div>
            </div>
        )
    }

    const [step, setStep] = useState<Step>(() => getLocalProfile() ? "phone" : "profile");
    const [loading, setLoading] = useState(false);

    const [phone, setPhone] = useState("");
    const countryCode = "+55";
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState(() => getLocalProfile()?.displayName ?? '');
    const [username, setUsername] = useState(() => getLocalProfile()?.username ?? '');
    const [error, setError] = useState<string | null>(null);
    const [floodWait, setFloodWait] = useState<number | null>(null);
    const [loginMethod, setLoginMethod] = useState<'phone' | 'qr'>('phone');
    const [appCredentialsReady, setAppCredentialsReady] = useState<boolean | null>(null);
    const [qrUrl, setQrUrl] = useState<string | null>(null);
    const [qrPolling, setQrPolling] = useState(false);
    const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);


    useEffect(() => {
        if (!floodWait) return;
        const interval = setInterval(() => {
            setFloodWait(prev => {
                if (prev === null || prev <= 1) return null;
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [floodWait]);

    useEffect(() => {
        if (step === 'phone' && loginMethod === 'phone') {
            setQrPolling(false);
            setQrUrl(null);
            setError(null);
        }
    }, [step, loginMethod]);

    useEffect(() => {
        void invoke<{ configured: boolean }>("cmd_auth_app_credentials_status")
            .then((status) => setAppCredentialsReady(status.configured))
            .catch(() => setAppCredentialsReady(false));
    }, []);

    const handleQrLogin = async () => {
        setError(null);
        setLoading(true);
        try {
            const url = await invoke<string>("cmd_auth_qr_login_simple");

            if (url === "__authorized__") {
                onLogin();
                return;
            }

            setQrUrl(url);
            setQrPolling(true);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    // QR polling effect
    useEffect(() => {
        if (!qrPolling) {
            if (qrPollRef.current) {
                clearInterval(qrPollRef.current);
                qrPollRef.current = null;
            }
            return;
        }

        qrPollRef.current = setInterval(async () => {
            try {
                const res = await invoke<{ success: boolean; next_step?: string }>("cmd_auth_qr_poll");
                if (res.success) {
                    setQrPolling(false);
                    if (res.next_step === "password") {
                        setStep("password");
                    } else {
                        onLogin();
                    }
                }
                // If next_step === "waiting", keep polling
            } catch {
                // Polling error — keep trying silently
            }
        }, 3000);

        return () => {
            if (qrPollRef.current) {
                clearInterval(qrPollRef.current);
                qrPollRef.current = null;
            }
        };
    }, [qrPolling, onLogin]);

    const handlePhoneSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const digits = phone.replace(/\D/g, '');
            const localDigits = digits.startsWith('55') && digits.length > 11
                ? digits.slice(2)
                : digits;
            if (localDigits.length < 10 || localDigits.length > 11) {
                throw new Error('Digite o DDD e o número do celular.');
            }
            const telegramPhone = `${countryCode}${localDigits}`;
            await invoke("cmd_auth_request_code_simple", { phone: telegramPhone });
            setStep("code");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : JSON.stringify(err);
            if (msg.includes("FLOOD_WAIT_")) {
                const parts = msg.split("FLOOD_WAIT_");
                if (parts[1]) {
                    const seconds = parseInt(parts[1]);
                    if (!isNaN(seconds)) {
                        setFloodWait(seconds);
                        return;
                    }
                }
            }
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleProfileSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); setError(null); setLoading(true);
        try {
            const profile = saveLocalProfile(displayName, username);
            await registerTCloudAccount(profile.displayName, profile.username);
            const saved = await invoke<boolean>('cmd_has_saved_session');
            if (saved) { onLogin(); return; }
            setStep('phone');
        } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
        finally { setLoading(false); }
    };

    const handleCodeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await invoke<{ success: boolean; next_step?: string }>("cmd_auth_sign_in", { code });
            if (res.success) {
                onLogin();
            } else if (res.next_step === "password") {
                setStep("password");
            } else {
                setError("Unknown error");
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await invoke<{ success: boolean; next_step?: string }>("cmd_auth_check_password", { password });
            if (res.success) {
                onLogin();
            } else {
                setError("Password verification failed.");
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-gradient relative flex h-full w-full items-center justify-center overflow-y-auto p-4 pt-[calc(1rem+env(safe-area-inset-top,24px))] text-app-text sm:p-6">
            <AuthThemeToggle />

            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="auth-glass my-auto w-full max-w-[26rem] rounded-overlay p-5 sm:p-6"
            >
                <div className="mb-6 text-center">
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center">
                        <img src="/logo.svg" alt="Logo" className="w-full h-full" />
                    </div>
                    <h1 className="text-app-title font-semibold tracking-[-0.01em] text-app-text">TCloud</h1>
                    <p className="mt-1 text-metadata text-app-text-secondary">Sua nuvem pessoal conectada ao Telegram</p>
                </div>

                <AnimatePresence mode="wait">
                    {floodWait ? (
                        <motion.div
                            key="flood"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-5 text-center"
                        >
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-container bg-app-danger/10">
                                <span className="text-xl">⏳</span>
                            </div>
                            <div>
                                <h2 className="text-app-title font-semibold text-app-text">Too Many Requests</h2>
                                <p className="mt-2 text-ui text-app-text-secondary">Telegram has temporarily limited your actions.</p>
                                <p className="text-ui text-app-text-secondary">Please wait before trying again.</p>
                            </div>

                            <div className="flex items-center justify-center font-mono text-3xl font-semibold tabular-nums text-app-accent">
                                {Math.floor(floodWait / 60)}:{(floodWait % 60).toString().padStart(2, '0')}
                            </div>

                            <p className="mt-4 text-metadata text-app-danger">
                                Do not restart the app. The timer will reset if you do.
                            </p>
                        </motion.div>
                    ) : (
                        <>

                            {step === "profile" && (
                                <motion.form key="profile" onSubmit={handleProfileSubmit} initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }} className="space-y-5">
                                    <div><h2 className="text-app-title font-semibold text-app-text">Crie seu perfil</h2><p className="mt-1 text-ui text-app-text-secondary">Este nome identifica você no TCloud e nos compartilhamentos.</p></div>
                                    <div className="space-y-2"><label className="auth-label">Seu nome</label><div className="relative"><UserRound className="auth-input-icon"/><input className="auth-input" value={displayName} onChange={e=>setDisplayName(e.target.value)} autoComplete="name" autoFocus placeholder="Como devemos chamar você?" maxLength={60}/></div></div>
                                    <div className="space-y-2"><label className="auth-label">Nome de usuário</label><div className="relative"><AtSign className="auth-input-icon"/><input className="auth-input" value={username} onChange={e=>setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} placeholder="seu_usuario" maxLength={32}/></div><p className="auth-phone-hint">Único no TCloud. Use letras, números ou _.</p></div>
                                    <button type="submit" disabled={loading} className="quiet-control auth-primary-action w-full">{loading?'Salvando…':<>Continuar <ArrowRight className="h-4 w-4"/></>}</button>
                                </motion.form>
                            )}




                            {step === "phone" && (
                                <motion.div
                                    key="phone"
                                    initial={{ x: 20, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -20, opacity: 0 }}
                                    className="space-y-5"
                                >
                                    {appCredentialsReady === false && (
                                        <div className="rounded-control border border-app-warning/30 bg-app-warning/10 p-3">
                                            <div className="flex items-start gap-2">
                                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-app-warning" />
                                                <div>
                                                    <p className="text-ui font-medium text-app-text">TCloud ainda não está configurado para login.</p>
                                                    <p className="mt-1 text-metadata leading-relaxed text-app-text-secondary">
                                                        O desenvolvedor precisa adicionar uma única credencial de aplicativo Telegram ao build do TCloud.
                                                        Usuários finais não precisam informar API ID ou API Hash.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {loginMethod === 'phone' ? (
                                        <form onSubmit={handlePhoneSubmit} className="space-y-5">
                                            <div className="space-y-2">
                                                <label className="auth-label">Telefone</label>
                                                <div className="auth-phone-row">
                                                    <div className="auth-country-code" title="Brasil">
                                                        <span className="auth-country-flag">🇧🇷</span>
                                                        <span>+55</span>
                                                    </div>
                                                    <div className="relative min-w-0 flex-1">
                                                        <Phone className="auth-input-icon" />
                                                        <input
                                                            type="tel"
                                                            inputMode="tel"
                                                            autoComplete="tel-national"
                                                            value={phone}
                                                            onChange={(e) => setPhone(e.target.value)}
                                                            placeholder="(92) 99999-9999"
                                                            className="auth-input tracking-wide"
                                                            autoFocus
                                                        />
                                                    </div>
                                                </div>
                                                <p className="auth-phone-hint">Brasil (+55) · digite apenas DDD + número.</p>
                                            </div>

                                            <div className="flex flex-col gap-3">
                                                <button
                                                    type="submit"
                                                    disabled={loading || appCredentialsReady !== true}
                                                    className="quiet-control auth-primary-action disabled:opacity-45"
                                                >
                                                    {loading ? "Conectando..." : <>Continuar <ArrowRight className="h-4 w-4 rtl:rotate-180" /></>}
                                                </button>
                                                <button type="button" onClick={() => setStep("phone")} className="quiet-control auth-secondary-action w-full">
                                                    Voltar
                                                </button>
                                            </div>
                                        </form>
                                    ) : (
                                        <div className="flex flex-col items-center gap-5">
                                            {loading && !qrUrl && (
                                                <div className="flex h-52 w-52 items-center justify-center rounded-container bg-app-surface-sunken/45">
                                                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
                                                </div>
                                            )}
                                            {qrUrl && (
                                                <>
                                                    <div className="rounded-container bg-white p-3 shadow-[var(--shadow-raised)]">
                                                        <QRCodeSVG
                                                            value={qrUrl}
                                                            size={200}
                                                            level="M"
                                                            bgColor="#ffffff"
                                                            fgColor="#000000"
                                                        />
                                                    </div>
                                                    <div className="text-center space-y-1">
                                                        <p className="text-ui text-app-text">Escaneie com o aplicativo Telegram</p>
                                                        <p className="text-metadata text-app-text-tertiary">Settings &gt; Devices &gt; Link Desktop Device</p>
                                                    </div>
                                                    {qrPolling && (
                                                        <div className="flex items-center gap-2 text-metadata text-app-accent">
                                                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
                                                            Aguardando leitura...
                                                        </div>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={handleQrLogin}
                                                        className="quiet-control auth-secondary-action px-2"
                                                    >
                                                        Atualizar QR Code
                                                    </button>
                                                </>
                                            )}
                                            <button type="button" onClick={() => { setLoginMethod("phone"); setQrPolling(false); setQrUrl(null); }} className="quiet-control auth-secondary-action w-full">
                                                Voltar
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                            )}


                            {step === "code" && (
                                <motion.form
                                    key="code"
                                    initial={{ x: 20, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -20, opacity: 0 }}
                                    onSubmit={handleCodeSubmit}
                                    className="space-y-5"
                                >
                                    <div className="space-y-2">
                                        <label className="auth-label">Código do Telegram</label>
                                        <div className="relative">
                                            <Key className="auth-input-icon" />
                                            <input
                                                type="text"
                                                value={code}
                                                onChange={(e) => setCode(e.target.value)}
                                                placeholder="1 2 3 4 5"
                                                className="auth-input pe-3 ps-10 text-center font-mono text-base tracking-[0.4em]"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="quiet-control auth-primary-action disabled:opacity-45"
                                        >
                                            {loading ? "Verificando..." : "Entrar"}
                                        </button>
                                        <button type="button" onClick={() => setStep("phone")} className="quiet-control auth-secondary-action w-full">
                                            Change Telefone
                                        </button>
                                    </div>
                                </motion.form>
                            )}


                            {step === "password" && (
                                <motion.form
                                    key="password"
                                    initial={{ x: 20, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -20, opacity: 0 }}
                                    onSubmit={handlePasswordSubmit}
                                    className="space-y-5"
                                >
                                    <div className="space-y-2">
                                        <div className="mb-4 rounded-control border border-app-accent/20 bg-app-selected p-3">
                                            <p className="text-center text-metadata text-app-accent">
                                                Sua conta possui verificação em duas etapas.
                                                Digite sua senha do Telegram para continuar.
                                            </p>
                                        </div>
                                        <label className="auth-label">Senha do Telegram</label>
                                        <div className="relative">
                                            <Lock className="auth-input-icon" />
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="Digite sua senha"
                                                className="auth-input"
                                                autoFocus
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        <button
                                            type="submit"
                                            disabled={loading || !password}
                                            className="quiet-control auth-primary-action disabled:opacity-45"
                                        >
                                            {loading ? "Verificando..." : "Unlock"}
                                        </button>
                                        <button type="button" onClick={() => { setStep("code"); setPassword(""); setError(null); }} className="quiet-control auth-secondary-action w-full">
                                            Back to Code Entry
                                        </button>
                                    </div>
                                </motion.form>
                            )}
                        </>
                    )}
                </AnimatePresence>

                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-5 flex items-start gap-2 rounded-control border border-app-danger/20 bg-app-danger/10 p-3"
                    >
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-2 shrink-0" />
                        <p className="text-ui leading-snug text-app-danger">{error}</p>
                    </motion.div>
                )}
            </motion.div>


            <AnimatePresence>
                
            </AnimatePresence>

            <AnimatePresence>
                
            </AnimatePresence>

        </div>
    );
}
