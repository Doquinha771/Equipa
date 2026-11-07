# Links de e-mail do Supabase caindo em `localhost`

## Por que acontece

Quando alguém cria conta ou pede para trocar a senha, o Supabase envia um e-mail
com um link. Depois de validar o link, o Supabase redireciona o usuário para o
endereço pedido pelo site (`redirect_to`). **Se esse endereço não estiver na lista
de URLs permitidas do projeto, o Supabase ignora o pedido e usa o "Site URL"**,
que por padrão é `http://localhost:3000`. Daí o erro.

## O que já foi corrigido no código

- `assets/js/config.js` tem `siteUrl: "https://doquinha771.github.io/Equipa/"`.
- `assets/js/supabase.js` envia esse endereço como `redirect_to` no cadastro,
  no reenvio de confirmação e na recuperação de senha.
- Ao voltar do link de recuperação, o site abre a tela **Definir nova senha**
  (antes o usuário entrava logado sem conseguir trocar a senha).
- Links vencidos ou já usados (`#error=access_denied&error_code=otp_expired`)
  mostram uma mensagem clara em vez de uma tela quebrada.

## O que precisa ser feito no painel (uma vez só)

Supabase → projeto `oxcfbsrukzfnzkivatsn` → **Authentication → URL Configuration**

| Campo | Valor |
| --- | --- |
| Site URL | `https://doquinha771.github.io/Equipa/` |
| Redirect URLs | `https://doquinha771.github.io/Equipa/` |
|  | `https://doquinha771.github.io/Equipa/**` |

Salve. Não precisa mexer em mais nada para os links pararem de ir para localhost.

> Se um dia o site mudar de endereço (domínio próprio, por exemplo), atualize
> `siteUrl` em `assets/js/config.js` **e** os dois campos acima.

## Modelos de e-mail (opcional, recomendado)

Em **Authentication → Email Templates** os modelos devem usar
`{{ .ConfirmationURL }}` (o padrão do Supabase já usa). Não use `{{ .SiteURL }}`
para montar o link, porque ele ignora o `redirect_to`.

Modelos em português prontos para colar estão em `supabase/templates/`:

- `confirm-signup.html` → *Confirm signup*
- `reset-password.html` → *Reset Password*
