const PROFILE_KEY = 'tcloud.user.profile.v1';

export interface TCloudUserProfile {
  displayName: string;
  username: string;
}

export function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

export function validateProfile(displayName: string, rawUsername: string): TCloudUserProfile {
  const name = displayName.trim().replace(/\s+/g, ' ');
  const username = normalizeUsername(rawUsername);
  if (name.length < 2 || name.length > 60) throw new Error('Informe um nome entre 2 e 60 caracteres.');
  if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new Error('O @usuário deve ter de 3 a 32 caracteres: letras, números ou _.');
  return { displayName: name, username };
}

export function getLocalProfile(): TCloudUserProfile | null {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') as Partial<TCloudUserProfile> | null;
    if (!value) return null;
    return validateProfile(value.displayName || '', value.username || '');
  } catch { return null; }
}

export function saveLocalProfile(displayName: string, username: string) {
  const profile = validateProfile(displayName, username);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent('tcloud-profile-changed', { detail: profile }));
  return profile;
}
