import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Download, ExternalLink, Chrome, Copy } from "lucide-react";
import { toast } from "sonner";

const STORAGE_KEY = "extension_onboarding_done";

export function ExtensionOnboarding({ userId }: { userId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const done = localStorage.getItem(`${STORAGE_KEY}:${userId}`);
    if (!done) setOpen(true);
  }, [userId]);

  const finish = () => {
    if (userId) localStorage.setItem(`${STORAGE_KEY}:${userId}`, "1");
    setOpen(false);
  };

  const handleDownload = () => {
    fetch("/monitor-extension.zip")
      .then((r) => { if (!r.ok) throw new Error("Falha no download"); return r.blob(); })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "monitor-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
        setDownloaded(true);
        setStep(2);
      })
      .catch((e) => toast.error(e.message));
  };

  const openExtensions = async () => {
    try {
      await navigator.clipboard.writeText("chrome://extensions");
      toast.success("Link copiado! Cole na barra de endereço de uma nova aba.");
    } catch {
      toast.message("Copie e cole na nova aba: chrome://extensions");
    }
    // Tenta abrir nova aba em branco — navegadores bloqueiam chrome:// via JS
    window.open("about:blank", "_blank");
    setStep(3);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) finish(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Chrome className="h-5 w-5 text-primary" /> Configure a Extensão do Chrome
          </DialogTitle>
          <DialogDescription>
            Para monitorar a navegação completa no navegador, siga os 3 passos abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between mb-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center flex-1">
              <div className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${step >= n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {step > n ? <Check className="h-4 w-4" /> : n}
              </div>
              {n < 3 && <div className={`h-0.5 flex-1 mx-1 ${step > n ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <h3 className="font-semibold">Passo 1 — Baixar a extensão</h3>
            <p className="text-sm text-muted-foreground">Clique abaixo para baixar o arquivo <code className="bg-muted px-1 rounded">monitor-extension.zip</code> e <b>descompacte-o</b> em uma pasta da sua escolha.</p>
            <Button onClick={handleDownload} className="w-full" size="lg">
              <Download className="h-4 w-4 mr-2" /> Baixar extensão (.zip)
            </Button>
            {downloaded && <p className="text-xs text-green-600">✓ Download iniciado. Descompacte o arquivo antes de continuar.</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <h3 className="font-semibold">Passo 2 — Abrir página de extensões</h3>
            <p className="text-sm text-muted-foreground">Vamos abrir uma nova aba. Em seguida, cole <code className="bg-muted px-1 rounded">chrome://extensions</code> na barra de endereço (o link foi copiado pra você).</p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
              <code className="text-sm flex-1">chrome://extensions</code>
              <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText("chrome://extensions"); toast.success("Copiado!"); }}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <Button onClick={openExtensions} className="w-full" size="lg">
              <ExternalLink className="h-4 w-4 mr-2" /> Abrir nova aba e copiar link
            </Button>
            <p className="text-xs text-muted-foreground">Navegadores bloqueiam abrir <code>chrome://</code> automaticamente — por isso é preciso colar manualmente.</p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <h3 className="font-semibold">Passo 3 — Instalar e fazer login</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Na aba <code className="bg-muted px-1 rounded">chrome://extensions</code>, ative o <b>Modo do desenvolvedor</b> (canto superior direito).</li>
              <li>Clique em <b>Carregar sem compactação</b>.</li>
              <li>Selecione a pasta descompactada do <code>monitor-extension</code>.</li>
              <li>Fixe a extensão (ícone de quebra-cabeça na barra) e clique nela.</li>
              <li><b>Faça login</b> com o mesmo email/senha deste painel.</li>
            </ol>
            <p className="text-xs text-muted-foreground">Funciona em Chrome, Edge, Brave, Opera e outros baseados em Chromium.</p>
          </div>
        )}

        <DialogFooter className="flex sm:justify-between gap-2">
          <Button variant="ghost" onClick={finish}>Pular por agora</Button>
          <div className="flex gap-2">
            {step > 1 && <Button variant="outline" onClick={() => setStep(step - 1)}>Voltar</Button>}
            {step < 3 && <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !downloaded}>Próximo</Button>}
            {step === 3 && <Button onClick={finish}>Concluir</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
