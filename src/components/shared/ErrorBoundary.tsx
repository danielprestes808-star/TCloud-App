import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    handleReload = () => window.location.reload();

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <main className="tcloud-crash-screen">
                <section className="tcloud-crash-card" role="alert">
                    <img src="/logo.svg" className="tcloud-crash-logo" alt="TCloud" />
                    <div className="tcloud-crash-icon"><AlertTriangle className="h-5 w-5" /></div>
                    <h1>O TCloud encontrou um problema</h1>
                    <p>A interface encontrou um erro inesperado. Seus arquivos e sua sessão não foram apagados.</p>

                    {this.state.error && (
                        <details>
                            <summary>Detalhes técnicos</summary>
                            <pre>{this.state.error.message}</pre>
                        </details>
                    )}

                    <button onClick={this.handleReload}>
                        <RefreshCw className="h-4 w-4" />
                        Recarregar TCloud
                    </button>
                </section>
            </main>
        );
    }
}
