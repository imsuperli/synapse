export const Platform = {
  OS: 'ios',
  select<T>(options: Record<string, T> & { default?: T }): T | undefined {
    return options.ios ?? options.default
  }
}

export const AppState = {
  currentState: 'active',
  addEventListener: () => ({
    remove() {}
  })
}

export const StyleSheet = {
  hairlineWidth: 1,
  absoluteFillObject: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  },
  create<T>(styles: T): T {
    return styles
  }
}

export const View = 'View'
export const Text = 'Text'
export const Pressable = 'Pressable'
export const ActivityIndicator = 'ActivityIndicator'
export const TextInput = 'TextInput'
export const ScrollView = 'ScrollView'
export const FlatList = 'FlatList'
export const RefreshControl = 'RefreshControl'

export default {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
}
