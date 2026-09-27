import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '../theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const open = (url: string) => Linking.openURL(url).catch(() => {});

export function H1({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.h2, style]}>{children}</Text>;
}
export function Body({ children, style, muted }: { children: React.ReactNode; style?: TextStyle; muted?: boolean }) {
  return <Text style={[s.body, muted && { color: colors.muted }, style]}>{children}</Text>;
}

export function Button({
  title, onPress, icon, variant = 'primary', style, small,
}: {
  title: string; onPress: () => void; icon?: IconName; variant?: 'primary' | 'outline' | 'ghost'; style?: ViewStyle; small?: boolean;
}) {
  const primary = variant === 'primary';
  const fg = primary ? colors.onAccent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        primary && { backgroundColor: colors.accent, borderColor: colors.accent },
        variant === 'ghost' && { borderColor: 'transparent' },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {icon && <Ionicons name={icon} size={small ? 16 : 18} color={fg} />}
      <Text style={[s.btnText, small && { fontSize: 13 }, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { borderColor: colors.accent }, style]}>
        {children}
      </Pressable>
    );
  return <View style={[s.card, style]}>{children}</View>;
}

export function IconBadge({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <View style={[s.badge, { width: size + 18, height: size + 18 }]}>
      <Ionicons name={name} size={size} color={colors.accent} />
    </View>
  );
}

export function Logo({ height = 30 }: { height?: number }) {
  // логотип Pulsecar (assets/logo-header.png, 300×119)
  return <Image source={require('../../assets/logo-header.png')} style={{ height, width: height * (300 / 119) }} resizeMode="contain" accessibilityLabel="Pulsecar" />;
}

export const s = StyleSheet.create({
  h1: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 36, color: colors.text },
  h2: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.text },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12 },
  btnText: { fontFamily: fonts.semibold, fontSize: 15 },
  card: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16,
  },
  badge: { borderRadius: 10, backgroundColor: colors.accentDim, alignItems: 'center', justifyContent: 'center' },
});
