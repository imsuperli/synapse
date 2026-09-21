import { forwardRef } from 'react'
import {
  Pressable as NativePressable,
  StyleSheet,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type View,
  type ViewStyle
} from 'react-native'

export function resolveMobilePressableStyle(
  style: PressableProps['style'],
  state: PressableStateCallbackType,
  disabled: boolean | null | undefined
): StyleProp<ViewStyle> {
  const resolvedStyle = typeof style === 'function' ? style(state) : style
  return [resolvedStyle, state.pressed && !disabled ? styles.pressed : null]
}

export const Pressable = forwardRef<View, PressableProps>(function Pressable(
  { style, disabled, ...props },
  ref
) {
  return (
    <NativePressable
      ref={ref}
      {...props}
      disabled={disabled}
      style={(state) => resolveMobilePressableStyle(style, state, disabled)}
    />
  )
})

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.72
  }
})
