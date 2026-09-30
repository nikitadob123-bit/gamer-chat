/* Публичная конфигурация. Здесь допустимы ТОЛЬКО URL проекта и anon key (публичный ключ).
   Пока поля пустые — приложение работает в демо-режиме (localStorage). */
window.GC_CONFIG = {
  SUPABASE_URL: 'https://quhioihlfftxozjmlcwz.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1aGlvaWhsZmZ0eG96am1sY3d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3ODgzMzIsImV4cCI6MjEwNjM2NDMzMn0.EnXPO5GtYo86GG9qVXzGac8UILx05KK67oboAvaEkYY',
  // Домен синтетического email для входа по нику (ник@домен). Письма на него не отправляются.
  // example.com Supabase отвергает, .invalid принимает (зарезервированный TLD, писем не существует).
  EMAIL_DOMAIN: 'gc-users.invalid'
};
