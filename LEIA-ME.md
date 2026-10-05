# Estoque TI — autenticação revisada

**Atualização:** o login agora também tem o botão **Entrar com Google**, mantendo os campos de e-mail e senha. Veja `ATIVAR-GOOGLE.md` para configurar o provedor. O retorno usa PKCE e validação da sessão antes de abrir o painel.

## Como usar

1. Extraia o ZIP e abra a pasta no VS Code.
2. A URL e a chave pública em `config.js` foram corrigidas com os valores fornecidos para o projeto `qadcyjuoowchgywanpml`. O endereço anterior apontava para outro projeto e não resolvia no DNS. Esta aplicação usa HTML e JavaScript diretamente: os valores já foram aplicados em `config.js`, sem necessidade de criar variáveis `NEXT_PUBLIC_*` ou arquivo `.env`. Nunca coloque chaves `service_role` ou `sb_secret` no navegador.
3. No **SQL Editor** do seu projeto Supabase:
   - **Se as tabelas já existem:** execute `migracao_auth.sql`.
   - **Se estiver começando com um banco vazio:** execute `setup_supabase.sql`, que já inclui a proteção de autenticação e os gatilhos do histórico.
   - `dados_exemplo.sql` é opcional; só execute se quiser adicionar os três equipamentos de demonstração.
4. Em **Authentication → Users**, crie um usuário com e-mail e senha ou utilize uma conta existente. A conta precisa ter o e-mail confirmado. Não há senha padrão nem cadastro público nesta interface.
5. Para uso interno, desative novos cadastros públicos nas configurações do Supabase Auth e mantenha o login anônimo desativado. Todos os usuários permanentes autenticados desse projeto podem consultar e gerenciar o mesmo estoque; esta versão não diferencia administrador e funcionário. Em um projeto compartilhado com outros aplicativos, separe os usuários ou estabeleça regras de autorização específicas antes de usar este estoque.
6. Abra `index.html` pelo **Live Server** do VS Code. Alternativamente, com Python instalado, execute `python -m http.server 5500` dentro da pasta e abra `http://localhost:5500`. Use um servidor HTTP local em vez de abrir o arquivo por duplo clique. É necessária conexão com a internet para carregar o Supabase e acessar o banco. Em hospedagem, utilize HTTPS.
7. Entre com a conta criada. Use **Sair** para encerrar a sessão neste navegador; o botão também aparece em telas pequenas.

**Atenção à ativação:** o código está atualizado, mas os scripts SQL não foram executados no seu banco remoto e nenhuma conta foi criada ou alterada. A proteção dos dados no servidor depende da aplicação do SQL. O login com credenciais reais ainda precisa ser validado no seu ambiente.

## Estrutura identificada

| Arquivo | Responsabilidade |
| --- | --- |
| `index.html` | Página única com login (`login-screen`), painel interno (`app-screen`), formulários, tabela e modais. |
| `style.css` | Aparência, layout em tela cheia, responsividade e tema escuro. |
| `app.js` | Login/logout, controle de sessão, cadastro, edição, exclusão, filtros, ordenação, paginação, histórico e CSV. |
| `config.js` | URL e chave pública do Supabase, separadas da lógica. |
| `setup_supabase.sql` | Instalação completa das tabelas, gatilhos, permissões e políticas. |
| `migracao_auth.sql` | Ajuste da proteção do banco existente, sem apagar equipamentos ou histórico. |
| `dados_exemplo.sql` | Três registros opcionais para demonstração. |
| `tests/auth.spec.cjs` | Testes de navegador com serviço simulado, sem consultar ou alterar o banco real. |

## O que mudou

O ZIP original **já usava Supabase Auth** e continha login, logout e políticas SQL básicas. Esta entrega revisa e completa essa integração:

- A sessão é validada com `getUser()` antes de abrir o painel e antes das operações protegidas. Sessões ausentes, inválidas ou anônimas não liberam acesso.
- O painel começa oculto e inativo. Links como `#estoque` e `#cadastro` não liberam suas seções sem autenticação. Como é um site estático, seu HTML e JavaScript continuam públicos; quem protege os registros é o Supabase com RLS.
- O SDK mantém e renova a sessão. O aplicativo revalida o acesso ao restaurar a página ou voltar à aba e reage aos eventos de autenticação, inclusive saída em outra aba.
- O callback de autenticação passou a ser síncrono, evitando chamadas ao Supabase dentro do bloqueio interno do SDK. Verificações posteriores são agendadas fora desse callback.
- O login impede envios repetidos e apresenta mensagens em português para credenciais inválidas, e-mail não confirmado e falhas de conexão.
- Ao sair, limpa tabelas, histórico, formulários, filtros e identificação do usuário, fecha modais e descarta respostas pendentes da sessão anterior. Senhas voltam a ficar ocultas.
- O logout usa escopo `local`: encerra a sessão deste navegador, sem desconectar outros dispositivos. Se o serviço recusar a saída, o aplicativo informa a falha e revalida a sessão para permitir nova tentativa; não informa sucesso indevidamente.
- O botão **Sair** também fica disponível no celular. A aparência e as demais funções foram mantidas.
- O SQL restringe o estoque a contas autenticadas permanentes, retira permissões públicas e impede escrita direta do cliente no histórico. O histórico continua sendo gravado pelos gatilhos do banco. Políticas restritivas impedem que políticas permissivas antigas liberem usuários sem sessão.
- O script de instalação não insere mais dados de demonstração automaticamente; eles foram separados em um arquivo opcional.

## Verificações realizadas

Foi verificada a sintaxe do JavaScript e executada uma suíte em Chrome sem interface, com Supabase simulado. Os cenários aprovados cobrem acesso direto sem sessão, ações ocultas, credenciais inválidas, falha de rede, envios duplicados, sessão salva, operações do estoque, CSV, tema, logout em outra aba, modais, respostas atrasadas, sessão inválida, falha de logout, saída móvel, contas anônimas e configuração ausente.

Esses testes verificam o comportamento do aplicativo. **Não comprovam a configuração do projeto remoto nem a execução das políticas SQL em um banco real.**

Para repetir os testes com Node.js e Playwright disponíveis:

```text
node tests/auth.spec.cjs
```

O Playwright precisa ter seu Chromium instalado. Como alternativa, defina `CHROME_PATH` com o caminho de uma instalação local do Chrome. Os dados e usuários usados no teste são fictícios e só existem no navegador de teste.

## Conferência final no seu Supabase

Depois de aplicar o SQL e criar a conta:

1. Abra uma janela anônima em `index.html#estoque`: somente o login deve aparecer.
2. Tente uma senha errada e depois a correta. Recarregue: a sessão válida deve permanecer.
3. Cadastre, edite e exclua um equipamento de teste e confira o histórico.
4. Abra o sistema em duas abas, saia em uma delas e confirme que a outra bloqueia o painel.
5. Confira **Sair** no celular e recarregue depois de sair: o login deve continuar aparecendo.
6. Na API do Supabase, uma consulta às tabelas usando apenas a chave pública, sem token de usuário, deve ser negada. Um usuário autenticado deve conseguir operar o estoque e somente consultar o histórico. Não use uma chave administrativa para conferir essa restrição, pois ela ignora RLS.

As políticas desta entrega abrangem `estoque` e `estoque_historico`. Views, funções e outros caminhos de acesso que tenham sido criados separadamente no banco precisam de avaliação própria.

## Referências

- [Login com e-mail e senha](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Validação do usuário](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Eventos de autenticação](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Proteção das tabelas com Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
