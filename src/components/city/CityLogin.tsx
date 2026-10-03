'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function CityLogin() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/city/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (response.ok) {
        router.refresh();
        return;
      }
      setError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Nie udało się zalogować.');
    } catch {
      setError('Brak połączenia z serwerem. Spróbuj ponownie.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Building2 aria-hidden="true" className="size-8 text-primary" />
          <CardTitle>
            <h1 className="text-xl font-bold">Panel zgłoszeń dla miasta</h1>
          </CardTitle>
          <CardDescription>Urząd Miasta Krakowa i Zarząd Dróg Miasta Krakowa. Zaloguj się hasłem służbowym.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="city-password">Hasło</Label>
              <Input
                id="city-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'city-login-error' : undefined}
              />
              {error && (
                <p id="city-login-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" disabled={busy || !password}>
              <LogIn aria-hidden="true" /> {busy ? 'Logowanie…' : 'Zaloguj się'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
