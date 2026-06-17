import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Download,
  Monitor,
  Apple,
  ShieldCheck,
  Eye,
  Clock,
  AlertTriangle,
  Settings,
  Play,
  ExternalLink,
  Cpu,
} from "lucide-react";
import { toast } from "sonner";

// URL onde os instaladores ficam hospedados (GitHub Releases).
const RELEASES_URL = "https://github.com/Halysson-Andrade/focus-track-sync/releases/latest";
const WIN_INSTALLER = `${RELEASES_URL}/download/Focus.Track.Monitor.Setup.exe`;
// macOS é distribuído como .zip (não .dmg): o empacotamento .dmg falhava de
// forma intermitente no hdiutil dos runners e gerava imagens que não montavam.
const MAC_ARM = `${RELEASES_URL}/download/Focus.Track.Monitor-arm64.zip`;
const MAC_INTEL = `${RELEASES_URL}/download/Focus.Track.Monitor-x64.zip`;

export const Route = createFileRoute("/_authenticated/desktop")({
  head: () => ({ meta: [{ title: "App Desktop de Monitoramento" }] }),
  component: DesktopPage,
});

function DesktopPage() {
  const downloadWin = () => {
    window.open(WIN_INSTALLER, "_blank");
    toast.success("Baixando instalador do Windows…");
  };
  const downloadMacArm = () => {
    window.open(MAC_ARM, "_blank");
    toast.success("Baixando app para Mac (Apple Silicon)…");
  };
  const downloadMacIntel = () => {
    window.open(MAC_INTEL, "_blank");
    toast.success("Baixando app para Mac (Intel)…");
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Monitor className="h-7 w-7 text-primary" /> App Desktop
        </h1>
        <p className="text-muted-foreground mt-1">
          Registra os aplicativos que você usa na máquina (VS Code, DBeaver, Photoshop, Chrome…).
          Complementa a extensão do navegador.
        </p>
      </div>

      {/* Step 1 - escolher sistema */}
      <Step number={1} title="Baixar o instalador">
        <p className="text-sm text-muted-foreground mb-4">
          Escolha o sistema operacional da sua máquina:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={downloadWin}
            className="flex items-center gap-4 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent hover:border-primary"
          >
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-blue-500/10 text-blue-600">
              <Monitor className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">Windows</div>
              <div className="text-xs text-muted-foreground">Instalador .exe (Windows 10/11)</div>
            </div>
            <Download className="h-5 w-5 text-muted-foreground" />
          </button>

          <button
            onClick={downloadMacArm}
            className="flex items-center gap-4 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent hover:border-primary"
          >
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-zinc-500/10 text-zinc-700 dark:text-zinc-300">
              <Apple className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">macOS — Apple Silicon</div>
              <div className="text-xs text-muted-foreground">
                .zip (Macs M1/M2/M3/M4 — a maioria desde 2020)
              </div>
            </div>
            <Download className="h-5 w-5 text-muted-foreground" />
          </button>

          <button
            onClick={downloadMacIntel}
            className="flex items-center gap-4 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent hover:border-primary"
          >
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-zinc-500/10 text-zinc-700 dark:text-zinc-300">
              <Apple className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">macOS — Intel</div>
              <div className="text-xs text-muted-foreground">
                .zip (Macs Intel, anteriores a 2020)
              </div>
            </div>
            <Download className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          O arquivo será salvo na sua pasta <b>Downloads</b>.
        </p>
      </Step>

      {/* Step 2 - instalar */}
      <Step number={2} title="Instalar o programa">
        <div className="space-y-4 text-sm">
          <div>
            <div className="font-medium flex items-center gap-2 mb-2">
              <Monitor className="h-4 w-4" /> No Windows
            </div>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-1">
              <li>
                Dê duplo clique em{" "}
                <code className="bg-muted px-1 rounded">Focus Track Monitor Setup.exe</code>.
              </li>
              <li>
                Se aparecer "O Windows protegeu seu PC" (SmartScreen), clique em{" "}
                <b>Mais informações</b> e depois em <b>Executar assim mesmo</b>. É normal — o app
                ainda não é assinado digitalmente.
              </li>
              <li>
                Siga o assistente de instalação e clique em <b>Concluir</b>.
              </li>
            </ol>
          </div>

          <div className="border-t pt-4">
            <div className="font-medium flex items-center gap-2 mb-2">
              <Apple className="h-4 w-4" /> No macOS
            </div>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-1">
              <li>
                Dê duplo clique no arquivo <code className="bg-muted px-1 rounded">.zip</code> para
                descompactar — vai aparecer o app <b>Focus Track Monitor</b>.
              </li>
              <li>
                Arraste o <b>Focus Track Monitor</b> para a pasta <b>Aplicativos</b>.
              </li>
              <li>
                Como o app ainda não é assinado, abra o <b>Terminal</b> e rode (cola e dá Enter):
                <code className="bg-muted px-1 rounded block mt-1 whitespace-pre-wrap">
                  xattr -cr "/Applications/Focus Track Monitor.app"
                </code>
              </li>
              <li>
                Depois clique com o <b>botão direito</b> no app → <b>Abrir</b> → <b>Abrir</b>. Se
                ainda bloquear, vá em <b>Ajustes do Sistema → Privacidade e Segurança</b> e clique
                em <b>Abrir Assim Mesmo</b>.
              </li>
            </ol>
          </div>
        </div>
      </Step>

      {/* Step 3 - login */}
      <Step number={3} title="Fazer login">
        <div className="grid gap-4 sm:grid-cols-[auto,1fr] items-start">
          <div className="grid h-16 w-16 place-items-center rounded-lg bg-primary/10 text-primary">
            <Play className="h-8 w-8" />
          </div>
          <div className="space-y-2 text-sm">
            <p>
              Abra o <b>Focus Track Monitor</b> (atalho na área de trabalho ou menu Iniciar).
            </p>
            <p>
              Use o <b>mesmo e-mail e senha</b> que você usa neste painel para entrar.
            </p>
            <p className="text-muted-foreground">
              Após o login, o monitoramento começa automaticamente e o app some pra barra de tarefas
              (ao lado do relógio, no Windows; barra superior no Mac).
            </p>
          </div>
        </div>
      </Step>

      {/* Step 4 - configurar */}
      <Step number={4} title="Configurar para iniciar com o sistema">
        <div className="grid gap-4 sm:grid-cols-[auto,1fr] items-start">
          <div className="grid h-16 w-16 place-items-center rounded-lg bg-primary/10 text-primary">
            <Settings className="h-8 w-8" />
          </div>
          <div className="space-y-2 text-sm">
            <p>
              Clique no ícone na bandeja do sistema → <b>Abrir painel</b>.
            </p>
            <p>
              Ative a opção <b>"Iniciar com o Windows/macOS"</b> para o monitor subir sozinho toda
              vez que você ligar a máquina — sem precisar abrir manualmente.
            </p>
            <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-xs">
              <b>Dica:</b> deixe o app sempre rodando em segundo plano. Ao reiniciar ou desligar a
              máquina, sua sessão é encerrada automaticamente.
            </div>
          </div>
        </div>
      </Step>

      {/* O que registra */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" /> O que o app registra
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <InfoLine
            icon={<Cpu className="h-4 w-4" />}
            label="Aplicativo ativo"
            desc="Nome do programa em foco (VS Code, Chrome, etc.)."
          />
          <InfoLine
            icon={<Clock className="h-4 w-4" />}
            label="Tempo por app"
            desc="Quanto tempo você usa cada programa."
          />
          <InfoLine
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Tempo ocioso"
            desc="Mouse/teclado parados por mais de 1 minuto."
          />
          <InfoLine
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Privacidade"
            desc="Apenas o nome do app — sem títulos de janela, prints ou conteúdo."
          />
        </CardContent>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            Para detalhar a navegação dentro do navegador (site, página, tempo por aba), instale
            também a{" "}
            <a href="/extensao" className="underline text-primary">
              extensão do Chrome
            </a>
            . O ideal é usar os dois juntos.
          </p>
        </CardContent>
      </Card>

      {/* Suporte */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Problemas?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>
            • <b>O app não inicia:</b> certifique-se de ter Windows 10+ ou macOS 11+.
          </p>
          <p>
            • <b>SmartScreen ou Gatekeeper bloqueou:</b> siga as instruções do passo 2.
          </p>
          <p>
            • <b>Não aparece nada na bandeja:</b> abra o app novamente pelo atalho.
          </p>
          <p>
            • <b>Login falha:</b> verifique a conexão e use as mesmas credenciais do painel.
          </p>
          <div className="pt-2">
            <Button asChild variant="outline" size="sm">
              <a href={RELEASES_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" /> Ver todas as versões
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
            {number}
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InfoLine({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary shrink-0">
        {icon}
      </span>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}
