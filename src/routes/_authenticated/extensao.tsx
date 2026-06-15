import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Download,
  Chrome,
  Copy,
  ExternalLink,
  RotateCcw,
  ShieldCheck,
  Eye,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  UnzipIllustration,
  ChromeUrlIllustration,
  DevModeIllustration,
  SelectFolderIllustration,
} from "@/components/ExtensionIllustrations";
import { toast } from "sonner";

// Mantém em sincronia com extension/manifest.json. Usado como cache-buster na URL
// do download: ao subir a versão, a URL muda e navegador/CDN não servem o ZIP
// antigo em cache.
const EXT_VERSION = "1.5.0";

export const Route = createFileRoute("/_authenticated/extensao")({
  head: () => ({ meta: [{ title: "Extensão de Monitoramento" }] }),
  component: ExtensaoPage,
});

function ExtensaoPage() {
  const { user } = useAuth();

  const download = () => {
    fetch(`/monitor-extension.zip?v=${EXT_VERSION}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Falha no download");
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "monitor-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success("Download iniciado — veja sua pasta Downloads.");
      })
      .catch((e) => toast.error(e.message));
  };

  const copyChromeUrl = async () => {
    try {
      await navigator.clipboard.writeText("chrome://extensions");
      toast.success("Link copiado! Cole numa nova aba do Chrome.");
    } catch {
      toast.message("Copie manualmente: chrome://extensions");
    }
  };

  const resetWizard = () => {
    if (user?.id) localStorage.removeItem(`extension_onboarding_done:${user.id}`);
    toast.success("Wizard será exibido novamente — recarregue a página.");
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Chrome className="h-7 w-7 text-primary" /> Extensão do Chrome
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitora a navegação em todo o Chrome — não apenas dentro deste painel.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={resetWizard}>
          <RotateCcw className="h-4 w-4 mr-2" /> Reexibir wizard
        </Button>
      </div>

      {/* Step 1 */}
      <Step number={1} title="Baixar o arquivo">
        <div className="grid gap-4 md:grid-cols-[1fr,auto] md:items-center">
          <p className="text-sm text-muted-foreground">
            Faça o download de <code className="bg-muted px-1 rounded">monitor-extension.zip</code>.
            O arquivo ficará na sua pasta <b>Downloads</b>.
          </p>
          <div className="md:justify-self-end md:text-right">
            <Button onClick={download} size="lg">
              <Download className="h-4 w-4 mr-2" /> Baixar extensão (.zip)
            </Button>
            <p className="mt-1.5 text-xs text-muted-foreground">Versão {EXT_VERSION}</p>
          </div>
        </div>
      </Step>

      {/* Step 2 */}
      <Step number={2} title="Descompactar o ZIP">
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          <UnzipIllustration />
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <span>
                  <b>Importante:</b> o Chrome <u>não aceita o arquivo .zip diretamente</u>. É
                  preciso descompactá-lo antes do próximo passo.
                </span>
              </div>
            </div>
            <p className="font-medium">Como descompactar:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>
                <b>Windows:</b> botão direito no ZIP → <i>Extrair tudo…</i>
              </li>
              <li>
                <b>Mac:</b> duplo clique no arquivo <code>.zip</code> (cria a pasta
                automaticamente).
              </li>
              <li>
                <b>Linux:</b> botão direito → <i>Extrair aqui</i>.
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Anote onde a pasta <code>monitor-extension</code> ficou — você vai selecioná-la no
              passo 4.
            </p>
          </div>
        </div>
      </Step>

      {/* Step 3 */}
      <Step number={3} title="Abrir a página de extensões do Chrome">
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          <ChromeUrlIllustration />
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Cole o endereço abaixo na barra de uma nova aba do Chrome:
            </p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
              <code className="text-sm flex-1">chrome://extensions</code>
              <Button size="sm" variant="ghost" onClick={copyChromeUrl}>
                <Copy className="h-3 w-3 mr-1" /> Copiar
              </Button>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                copyChromeUrl();
                window.open("about:blank", "_blank");
              }}
            >
              <ExternalLink className="h-4 w-4 mr-2" /> Copiar e abrir nova aba
            </Button>
            <p className="text-xs text-muted-foreground">
              Navegadores bloqueiam abrir <code>chrome://</code> automaticamente — por isso o link
              precisa ser colado manualmente.
            </p>
          </div>
        </div>
      </Step>

      {/* Step 4 */}
      <Step number={4} title="Instalar e fazer login">
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          <div className="space-y-3">
            <DevModeIllustration />
            <SelectFolderIllustration />
          </div>
          <div className="space-y-3 text-sm">
            <ol className="list-decimal list-inside space-y-2">
              <li>
                Em <code className="bg-muted px-1 rounded">chrome://extensions</code>, ative o{" "}
                <b>Modo do desenvolvedor</b> (canto superior direito).
              </li>
              <li>
                Clique em <b>Carregar sem compactação</b>.
              </li>
              <li>
                Selecione a <b>pasta</b> <code>monitor-extension</code> que você descompactou —
                <u>não o arquivo .zip</u>.
              </li>
              <li>Fixe a extensão (ícone de quebra-cabeça na barra) e clique nela.</li>
              <li>
                <b>Faça login</b> com o mesmo email/senha deste painel.
              </li>
            </ol>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Se aparecer a janela "Selecione um diretório de extensão" e o ZIP não estiver listado,
              é normal — só pastas aparecem. Volte ao passo 2 se ainda não descompactou.
            </div>
          </div>
        </div>
      </Step>

      {/* O que é registrado */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" /> O que a extensão registra
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <InfoLine
            icon={<Chrome className="h-4 w-4" />}
            label="Sites visitados"
            desc="URL, domínio e título da página."
          />
          <InfoLine
            icon={<Clock className="h-4 w-4" />}
            label="Tempo por site"
            desc="Quanto tempo você ficou em cada página."
          />
          <InfoLine
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Tempo ocioso"
            desc="Mouse/teclado parados por mais de 1 minuto."
          />
          <InfoLine
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Foco da janela"
            desc="Quando o Chrome perde o foco para outro app."
          />
        </CardContent>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            Outros navegadores (Firefox, Safari) e aplicativos fora do navegador <b>não</b> são
            monitorados. Funciona em Chrome, Edge, Brave, Opera e outros baseados em Chromium.
          </p>
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
