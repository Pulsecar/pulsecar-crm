import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './api';

// уведомление, пришедшее при открытом приложении, тоже показываем баннером
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function pushState(): Promise<PushState> {
  if (!Device.isDevice || Platform.OS === 'web') return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

/** Запросить разрешение (системный диалог) и отправить push-токен в CRM. Без разрешения приложение работает как обычно. */
export async function registerPush(ask: boolean): Promise<PushState> {
  if (!Device.isDevice || Platform.OS === 'web') return 'unsupported';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Pulsecar CRM', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200], lightColor: '#1BF372' });
  }
  let p = await Notifications.getPermissionsAsync();
  if (!p.granted && p.canAskAgain && ask) p = await Notifications.requestPermissionsAsync();
  if (!p.granted) return p.canAskAgain ? 'undetermined' : 'denied';
  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api('/mobile/device', { method: 'PUT', body: { push_token: t.data } });
  } catch {
    // нет projectId (сборка без EAS) или нет сети — попробуем при следующем запуске
  }
  return 'granted';
}
