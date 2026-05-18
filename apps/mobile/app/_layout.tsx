import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function Root() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: "#fff" } }}>
        <Stack.Screen name="index" options={{ title: "GoGet" }} />
        <Stack.Screen name="search" options={{ title: "Results" }} />
        <Stack.Screen name="product-webview" options={{ title: "Order on marketplace" }} />
        <Stack.Screen name="checkout" options={{ title: "Schedule delivery" }} />
        <Stack.Screen name="orders" options={{ title: "Your orders" }} />
        <Stack.Screen name="orders/[shortCode]" options={{ title: "Order status" }} />
        <Stack.Screen name="account" options={{ title: "Account" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
