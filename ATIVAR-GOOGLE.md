# Ativar o botão Entrar com Google

O botão está implementado. Os campos de e-mail e senha continuam funcionando. A ativação depende das credenciais OAuth da sua conta; elas não vieram no ZIP.

1. No **Google Auth Platform**, configure o aplicativo e crie um cliente OAuth do tipo **Aplicativo da Web**. Cadastre a origem do site, como `http://localhost:5500`. Na audiência, autorize suas contas de teste, caso aplicável.
2. Em **URIs de redirecionamento autorizados** do Google, cadastre o callback exibido pelo Supabase. Para o projeto atual:

   `https://qadcyjuoowchgywanpml.supabase.co/auth/v1/callback`

3. No **Supabase → Authentication → Sign In / Providers → Google**, ative o provedor e salve o **Client ID** e o **Client Secret** do Google. O segredo fica somente no Supabase, nunca no JavaScript.
4. Em **Authentication → URL Configuration**, configure o **Site URL** e adicione aos **Redirect URLs** o endereço exato de retorno do aplicativo, por exemplo `http://localhost:5500/index.html`. Se abrir pela raiz `/`, autorize também `http://localhost:5500/`. Para outro domínio, porta ou subpasta, use os endereços correspondentes.

   Na captura enviada, o Live Server usa `127.0.0.1`. Para esse endereço, cadastre também `http://127.0.0.1:5500/index.html` nos **Redirect URLs** do Supabase; se abrir pela raiz, inclua `http://127.0.0.1:5500/`. `localhost` e `127.0.0.1` são endereços diferentes para essa configuração.

5. Abra pelo Live Server, clique em **Entrar com Google**, escolha sua conta e conclua o acesso. Volte no mesmo navegador, necessário para a verificação PKCE.

O retorno do Google passa pelo Supabase e volta ao sistema. O painel só abre depois da validação da sessão. Cancelamentos e falhas mantêm o painel bloqueado.

**Acesso interno:** mantenha contas previamente autorizadas. Permitir novos cadastros no Supabase pode permitir que novas contas Google entrem no estoque compartilhado. O botão não altera essa configuração.

**Teste:** os fluxos de interface e retorno foram testados com serviço simulado. A autorização Google real ainda depende dessa configuração. As políticas SQL da entrega anterior continuam necessárias e não mudaram nesta atualização.

Referências: [Google no Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google) e [URLs de retorno](https://supabase.com/docs/guides/auth/redirect-urls).
