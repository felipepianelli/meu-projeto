import { useEffect, useState } from 'react'
import {
  beginSkoreLogin,
  fetchConnectionStatus,
  fetchDashboardData,
  hasConfiguredApi,
  hasToken,
} from '../services/skoreApi'
import type { ConnectionStatus, DashboardData } from '../types'

type DashboardState = {
  connection: ConnectionStatus | null
  data: DashboardData | null
  isLoading: boolean
  isRefreshing: boolean
  isLoggingIn: boolean
  error: string | null
}

export function useSkoreDashboard() {
  const [state, setState] = useState<DashboardState>({
    connection: null,
    data: null,
    isLoading: true,
    isRefreshing: false,
    isLoggingIn: false,
    error: null,
  })

  useEffect(() => {
    const controller = new AbortController()

    void loadDashboard(controller.signal)

    return () => controller.abort()
  }, [])

  async function loadDashboard(signal?: AbortSignal, options?: { refreshing?: boolean }) {
    setState((current) => ({
      ...current,
      isLoading: !options?.refreshing && !current.data,
      isRefreshing: Boolean(options?.refreshing),
      error: null,
    }))

    try {
      const [connection, data] = await Promise.all([
        fetchConnectionStatus(signal),
        fetchDashboardData(signal),
      ])

      setState((current) => ({
        ...current,
        connection,
        data,
        isLoading: false,
        isRefreshing: false,
        error: null,
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        isLoading: false,
        isRefreshing: false,
        error: error instanceof Error ? error.message : 'Erro inesperado ao carregar',
      }))
    }
  }

  async function refresh() {
    await loadDashboard(undefined, { refreshing: true })
  }

  async function login() {
    setState((current) => ({
      ...current,
      isLoggingIn: true,
      error: null,
    }))

    try {
      await beginSkoreLogin()
      await loadDashboard(undefined, { refreshing: true })
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Falha ao iniciar login',
      }))
    } finally {
      setState((current) => ({
        ...current,
        isLoggingIn: false,
      }))
    }
  }

  return {
    ...state,
    refresh,
    login,
    hasConfiguredApi: hasConfiguredApi(),
    hasToken: hasToken(),
  }
}
