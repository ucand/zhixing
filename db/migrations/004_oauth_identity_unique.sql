-- One Zhihu provider identity must map to exactly one application user.
create unique index if not exists zhihu_oauth_account_identity_uidx
  on zhihu_oauth_account(provider, provider_user_id)
  where provider_user_id is not null;
