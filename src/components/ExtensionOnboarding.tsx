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
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="flex items-center flex-1">
              <div className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${step >= n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {step > n ? <Check className="h-4 w-4" /> : n}
              </div>
              {n < 4 && <div className={`h-0.5 flex-1 mx-1 ${step > n ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <h3 className="font-semibold">Passo 1 — Baixar o arquivo</h3>
            <p className="text-sm text-muted-foreground">Clique abaixo para baixar <code className="bg-muted px-1 rounded">monitor-extension.zip</code>.</p>
            <Button onClick={handleDownload} className="w-full" size="lg">
              <Download className="h-4 w-4 mr-2" /> Baixar extensão (.zip)
            </Button>
            {downloaded && <p className="text-xs text-green-600">✓ Download iniciado.</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <h3 className="font-semibold">Passo 2 — Descompactar o ZIP</h3>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <b>⚠️ Importante:</b> o Chrome <u>não aceita o arquivo .zip diretamente</u>. Você precisa descompactá-lo em uma pasta antes do próximo passo.
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-medium">Como descompactar:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li><b>Windows:</b> clique com o botão direito no ZIP → <i>Extrair tudo…</i> → escolha uma pasta.</li>
                <li><b>Mac:</b> dê duplo clique no arquivo <code className="bg-muted px-1 rounded">.zip</code> (cria a pasta automaticamente).</li>
                <li><b>Linux:</b> botão direito → <i>Extrair aqui</i>.</li>
              </ul>
              <p className="text-xs text-muted-foreground pt-1">Anote onde a pasta <code>monitor-extension</code> ficou — você vai selecioná-la no passo 4.</p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <h3 className="font-semibold">Passo 3 — Abrir página de extensões</h3>
            <p className="text-sm text-muted-foreground">Cole <code className="bg-muted px-1 rounded">chrome://extensions</code> na barra de endereço de uma nova aba (o link será copiado).</p>
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

        {step === 4 && (
          <div className="space-y-3">
            <h3 className="font-semibold">Passo 4 — Instalar e fazer login</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Em <code className="bg-muted px-1 rounded">chrome://extensions</code>, ative o <b>Modo do desenvolvedor</b> (canto superior direito).</li>
              <li>Clique em <b>Carregar sem compactação</b>.</li>
              <li>Selecione a <b>pasta</b> <code>monitor-extension</code> que você descompactou (não o arquivo .zip).</li>
              <li>Fixe a extensão (ícone de quebra-cabeça na barra) e clique nela.</li>
              <li><b>Faça login</b> com o mesmo email/senha deste painel.</li>
            </ol>
            <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              Se aparecer "Selecione um diretório de extensão" e o ZIP não estiver listado, é normal — só pastas aparecem. Volte ao passo 2 se ainda não descompactou.
            </div>
          </div>
        )}

        <DialogFooter className="flex sm:justify-between gap-2">
          <Button variant="ghost" onClick={finish}>Pular por agora</Button>
          <div className="flex gap-2">
            {step > 1 && <Button variant="outline" onClick={() => setStep(step - 1)}>Voltar</Button>}
            {step < 4 && <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !downloaded}>Próximo</Button>}
            {step === 4 && <Button onClick={finish}>Concluir</Button>}

          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
