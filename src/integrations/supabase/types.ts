export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      atividade_apontamentos: {
        Row: {
          atividade_id: string
          criado_em: string
          duracao_segundos: number | null
          fim: string | null
          id: string
          inicio: string
          registro_id: string | null
          usuario_id: string
        }
        Insert: {
          atividade_id: string
          criado_em?: string
          duracao_segundos?: number | null
          fim?: string | null
          id?: string
          inicio?: string
          registro_id?: string | null
          usuario_id: string
        }
        Update: {
          atividade_id?: string
          criado_em?: string
          duracao_segundos?: number | null
          fim?: string | null
          id?: string
          inicio?: string
          registro_id?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atividade_apontamentos_atividade_id_fkey"
            columns: ["atividade_id"]
            isOneToOne: false
            referencedRelation: "atividades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atividade_apontamentos_registro_id_fkey"
            columns: ["registro_id"]
            isOneToOne: false
            referencedRelation: "registros_atividade"
            referencedColumns: ["id"]
          },
        ]
      }
      atividade_diaria: {
        Row: {
          dia: string
          fim_jornada: string | null
          inicio_jornada: string | null
          minutos_almoco: number
          minutos_ativo: number
          minutos_inativo: number
          minutos_pausa: number
          updated_at: string
          usuario_id: string
        }
        Insert: {
          dia: string
          fim_jornada?: string | null
          inicio_jornada?: string | null
          minutos_almoco?: number
          minutos_ativo?: number
          minutos_inativo?: number
          minutos_pausa?: number
          updated_at?: string
          usuario_id: string
        }
        Update: {
          dia?: string
          fim_jornada?: string | null
          inicio_jornada?: string | null
          minutos_almoco?: number
          minutos_ativo?: number
          minutos_inativo?: number
          minutos_pausa?: number
          updated_at?: string
          usuario_id?: string
        }
        Relationships: []
      }
      atividades: {
        Row: {
          atualizado_em: string
          contexto: string | null
          criado_em: string
          external_id: string
          external_url: string | null
          fonte: string
          id: string
          titulo: string
          total_segundos: number
          usuario_id: string
        }
        Insert: {
          atualizado_em?: string
          contexto?: string | null
          criado_em?: string
          external_id: string
          external_url?: string | null
          fonte: string
          id?: string
          titulo: string
          total_segundos?: number
          usuario_id: string
        }
        Update: {
          atualizado_em?: string
          contexto?: string | null
          criado_em?: string
          external_id?: string
          external_url?: string | null
          fonte?: string
          id?: string
          titulo?: string
          total_segundos?: number
          usuario_id?: string
        }
        Relationships: []
      }
      categoria_atividade: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          id: string
          identificador: string
          produtiva: boolean
          tipo: string
        }
        Insert: {
          ativo?: boolean
          categoria: string
          created_at?: string
          id?: string
          identificador: string
          produtiva?: boolean
          tipo: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          identificador?: string
          produtiva?: boolean
          tipo?: string
        }
        Relationships: []
      }
      eventos_ociosidade: {
        Row: {
          created_at: string
          fim: string
          fonte: string
          id: string
          inicio: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          fim: string
          fonte: string
          id?: string
          inicio: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          fim?: string
          fonte?: string
          id?: string
          inicio?: string
          usuario_id?: string
        }
        Relationships: []
      }
      monitor_idle_whitelist: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          identificador: string
          label: string | null
          tipo: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          identificador: string
          label?: string | null
          tipo: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          identificador?: string
          label?: string | null
          tipo?: string
        }
        Relationships: []
      }
      navegacao_diaria: {
        Row: {
          dia: string
          domain: string
          segundos_inativos: number
          segundos_totais: number
          updated_at: string
          usuario_id: string
          visitas: number
        }
        Insert: {
          dia: string
          domain: string
          segundos_inativos?: number
          segundos_totais?: number
          updated_at?: string
          usuario_id: string
          visitas?: number
        }
        Update: {
          dia?: string
          domain?: string
          segundos_inativos?: number
          segundos_totais?: number
          updated_at?: string
          usuario_id?: string
          visitas?: number
        }
        Relationships: []
      }
      navegacao_externa: {
        Row: {
          created_at: string
          domain: string
          duracao_segundos: number | null
          fim: string | null
          id: string
          inativo_segundos: number
          inicio: string
          janela_focada: boolean
          title: string | null
          url: string
          user_agent: string | null
          usuario_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          duracao_segundos?: number | null
          fim?: string | null
          id?: string
          inativo_segundos?: number
          inicio?: string
          janela_focada?: boolean
          title?: string | null
          url: string
          user_agent?: string | null
          usuario_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          duracao_segundos?: number | null
          fim?: string | null
          id?: string
          inativo_segundos?: number
          inicio?: string
          janela_focada?: boolean
          title?: string | null
          url?: string
          user_agent?: string | null
          usuario_id?: string
        }
        Relationships: []
      }
      navegacao_paginas: {
        Row: {
          created_at: string
          duracao_segundos: number | null
          fim: string | null
          id: string
          inativo_segundos: number
          inicio: string
          path: string
          registro_id: string | null
          title: string | null
          usuario_id: string
        }
        Insert: {
          created_at?: string
          duracao_segundos?: number | null
          fim?: string | null
          id?: string
          inativo_segundos?: number
          inicio?: string
          path: string
          registro_id?: string | null
          title?: string | null
          usuario_id: string
        }
        Update: {
          created_at?: string
          duracao_segundos?: number | null
          fim?: string | null
          id?: string
          inativo_segundos?: number
          inicio?: string
          path?: string
          registro_id?: string | null
          title?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "navegacao_paginas_registro_id_fkey"
            columns: ["registro_id"]
            isOneToOne: false
            referencedRelation: "registros_atividade"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          conteudo: string
          criado_em: string
          destinatario_id: string
          entregue_em: string | null
          id: string
          lido_em: string | null
          remetente_id: string
          remetente_nome: string
        }
        Insert: {
          conteudo: string
          criado_em?: string
          destinatario_id: string
          entregue_em?: string | null
          id?: string
          lido_em?: string | null
          remetente_id: string
          remetente_nome: string
        }
        Update: {
          conteudo?: string
          criado_em?: string
          destinatario_id?: string
          entregue_em?: string | null
          id?: string
          lido_em?: string | null
          remetente_id?: string
          remetente_nome?: string
        }
        Relationships: []
      }
      presenca_desktop: {
        Row: {
          app_version: string | null
          platform: string | null
          ultimo_ativo: string
          ultimo_visto: string | null
          usuario_id: string
        }
        Insert: {
          app_version?: string | null
          platform?: string | null
          ultimo_ativo?: string
          ultimo_visto?: string | null
          usuario_id: string
        }
        Update: {
          app_version?: string | null
          platform?: string | null
          ultimo_ativo?: string
          ultimo_visto?: string | null
          usuario_id?: string
        }
        Relationships: []
      }
      presenca_extensao: {
        Row: {
          ext_version: string | null
          ultimo_visto: string
          usuario_id: string
        }
        Insert: {
          ext_version?: string | null
          ultimo_visto?: string
          usuario_id: string
        }
        Update: {
          ext_version?: string | null
          ultimo_visto?: string
          usuario_id?: string
        }
        Relationships: []
      }
      presenca_web: {
        Row: {
          ultimo_ativo: string
          updated_at: string
          usuario_id: string
        }
        Insert: {
          ultimo_ativo?: string
          updated_at?: string
          usuario_id: string
        }
        Update: {
          ultimo_ativo?: string
          updated_at?: string
          usuario_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ativo: boolean
          cargo: string | null
          created_at: string
          departamento: string | null
          email: string
          id: string
          must_change_password: boolean
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cargo?: string | null
          created_at?: string
          departamento?: string | null
          email: string
          id: string
          must_change_password?: boolean
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cargo?: string | null
          created_at?: string
          departamento?: string | null
          email?: string
          id?: string
          must_change_password?: boolean
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      registros_atividade: {
        Row: {
          created_at: string
          duracao_minutos: number | null
          fim: string | null
          id: string
          inicio: string
          observacao: string | null
          status: Database["public"]["Enums"]["activity_status"]
          usuario_id: string
        }
        Insert: {
          created_at?: string
          duracao_minutos?: number | null
          fim?: string | null
          id?: string
          inicio?: string
          observacao?: string | null
          status: Database["public"]["Enums"]["activity_status"]
          usuario_id: string
        }
        Update: {
          created_at?: string
          duracao_minutos?: number | null
          fim?: string | null
          id?: string
          inicio?: string
          observacao?: string | null
          status?: Database["public"]["Enums"]["activity_status"]
          usuario_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      uso_aplicativos: {
        Row: {
          app_label: string | null
          created_at: string
          duracao_segundos: number | null
          executable_path: string | null
          fim: string | null
          id: string
          inativo_segundos: number | null
          inicio: string
          platform: string | null
          process_name: string
          usuario_id: string
        }
        Insert: {
          app_label?: string | null
          created_at?: string
          duracao_segundos?: number | null
          executable_path?: string | null
          fim?: string | null
          id?: string
          inativo_segundos?: number | null
          inicio?: string
          platform?: string | null
          process_name: string
          usuario_id: string
        }
        Update: {
          app_label?: string | null
          created_at?: string
          duracao_segundos?: number | null
          executable_path?: string | null
          fim?: string | null
          id?: string
          inativo_segundos?: number | null
          inicio?: string
          platform?: string | null
          process_name?: string
          usuario_id?: string
        }
        Relationships: []
      }
      uso_app_diario: {
        Row: {
          app_label: string | null
          dia: string
          process_name: string
          segundos_inativos: number
          segundos_totais: number
          sessoes: number
          updated_at: string
          usuario_id: string
        }
        Insert: {
          app_label?: string | null
          dia: string
          process_name: string
          segundos_inativos?: number
          segundos_totais?: number
          sessoes?: number
          updated_at?: string
          usuario_id: string
        }
        Update: {
          app_label?: string | null
          dia?: string
          process_name?: string
          segundos_inativos?: number
          segundos_totais?: number
          sessoes?: number
          updated_at?: string
          usuario_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abrir_registro: {
        Args: { p_observacao?: string; p_status: string }
        Returns: {
          created_at: string
          duracao_minutos: number | null
          fim: string | null
          id: string
          inicio: string
          observacao: string | null
          status: Database["public"]["Enums"]["activity_status"]
          usuario_id: string
        }
        SetofOptions: {
          from: "*"
          to: "registros_atividade"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      agregar_dia: { Args: { p_dia: string }; Returns: undefined }
      encerrar_sessoes_ociosas: {
        Args: { p_timeout_min?: number }
        Returns: number
      }
      enviar_notificacao: {
        Args: { p_conteudo: string; p_destinatario: string }
        Returns: {
          conteudo: string
          criado_em: string
          destinatario_id: string
          entregue_em: string | null
          id: string
          lido_em: string | null
          remetente_id: string
          remetente_nome: string
        }
        SetofOptions: {
          from: "*"
          to: "notificacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fechar_apontamento_aberto: {
        Args: { p_fim: string; p_uid: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      iniciar_atividade: {
        Args: {
          p_contexto?: string
          p_external_id: string
          p_external_url: string
          p_fonte: string
          p_titulo: string
        }
        Returns: {
          atividade_id: string
          criado_em: string
          duracao_segundos: number | null
          fim: string | null
          id: string
          inicio: string
          registro_id: string | null
          usuario_id: string
        }
        SetofOptions: {
          from: "*"
          to: "atividade_apontamentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_active: { Args: { _user_id: string }; Returns: boolean }
      parar_atividade: {
        Args: never
        Returns: {
          atividade_id: string
          criado_em: string
          duracao_segundos: number | null
          fim: string | null
          id: string
          inicio: string
          registro_id: string | null
          usuario_id: string
        }
        SetofOptions: {
          from: "*"
          to: "atividade_apontamentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      purgar_brutos_antigos: {
        Args: { p_dias_retencao?: number }
        Returns: {
          removidos: number
          tabela: string
        }[]
      }
    }
    Enums: {
      activity_status: "ATIVO" | "PAUSA" | "ALMOCO" | "INATIVO" | "ENCERRADO"
      app_role: "admin" | "user" | "superadmin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_status: ["ATIVO", "PAUSA", "ALMOCO", "INATIVO", "ENCERRADO"],
      app_role: ["admin", "user", "superadmin"],
    },
  },
} as const
