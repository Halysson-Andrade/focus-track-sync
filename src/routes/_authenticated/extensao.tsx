import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Chrome } from "lucide-react";

export const Route = createFileRoute("/_authenticated/extensao")({
  head: () => ({ meta: [{ title: "Extensão de Monitoramento" }] }),
  component: ExtensaoPage,
});

function ExtensaoPage() {
  const download = () => {
    fetch("/monitor-extension.zip")
      .then((r) => { if (!r.ok) throw new Error("Falha no download"); return r.blob(); })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "monitor-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => alert(e.message));
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Extensão do Chrome</h1>
        <p className="text-muted-foreground">Monitora a navegação em todo o Chrome (não só neste app).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Chrome className="h-5 w-5"/> 1. Baixar</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={download} size="lg"><Download className="h-4 w-4 mr-2"/> Baixar extensão (.zip)</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Instalar no Chrome</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal list-inside space-y-2">
            <li><b>Descompacte</b> o arquivo <code className="bg-muted px-1 rounded">monitor-extension.zip</code> em uma pasta da sua escolha.</li>
            <li>Abra o Chrome em <code className="bg-muted px-1 rounded">chrome://extensions</code></li>
            <li>Ative o <b>Modo do desenvolvedor</b> (canto superior direito).</li>
            <li>Clique em <b>Carregar sem compactação</b> e selecione a pasta descompactada.</li>
            <li>Clique no ícone da extensão (quebra-cabeça → fixar) e <b>faça login</b> com o mesmo email/senha deste painel.</li>
          </ol>
          <p className="text-muted-foreground pt-2">Funciona em qualquer navegador baseado em Chromium (Chrome, Edge, Brave, Opera).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>O que é registrado</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>✔ Sites visitados (URL, domínio, título)</p>
          <p>✔ Tempo gasto em cada site</p>
          <p>✔ Tempo ocioso do sistema (mouse/teclado parados por mais de 1 min)</p>
          <p>✔ Quando a janela do Chrome perde foco</p>
          <p className="text-muted-foreground pt-2">Outros navegadores (Firefox, Safari) e apps fora do navegador não são monitorados.</p>
        </CardContent>
      </Card>
    </div>
  );
}
