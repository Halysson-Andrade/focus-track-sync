
-- eventos_ociosidade
DROP POLICY IF EXISTS "Users manage own eventos_ociosidade" ON public.eventos_ociosidade;
CREATE POLICY "Users manage own eventos_ociosidade"
ON public.eventos_ociosidade
FOR ALL
TO authenticated
USING (
  (auth.uid() = usuario_id AND public.is_active(auth.uid()))
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (
  (auth.uid() = usuario_id AND public.is_active(auth.uid()))
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- presenca_desktop
DROP POLICY IF EXISTS "Users manage own presence" ON public.presenca_desktop;
CREATE POLICY "Users manage own presence"
ON public.presenca_desktop
FOR ALL
TO authenticated
USING (auth.uid() = usuario_id AND public.is_active(auth.uid()))
WITH CHECK (auth.uid() = usuario_id AND public.is_active(auth.uid()));

-- presenca_web
DROP POLICY IF EXISTS "Users manage own presenca_web" ON public.presenca_web;
CREATE POLICY "Users manage own presenca_web"
ON public.presenca_web
FOR ALL
TO authenticated
USING (auth.uid() = usuario_id AND public.is_active(auth.uid()))
WITH CHECK (auth.uid() = usuario_id AND public.is_active(auth.uid()));

-- uso_aplicativos
DROP POLICY IF EXISTS "Users manage own app usage" ON public.uso_aplicativos;
CREATE POLICY "Users manage own app usage"
ON public.uso_aplicativos
FOR ALL
TO authenticated
USING (auth.uid() = usuario_id AND public.is_active(auth.uid()))
WITH CHECK (auth.uid() = usuario_id AND public.is_active(auth.uid()));
