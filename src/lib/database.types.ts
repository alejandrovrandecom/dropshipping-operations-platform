export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      launch_checklist_items: {
        Row: {
          checklist_id: string
          created_at: string
          created_by: string | null
          id: string
          is_complete: boolean
          is_required: boolean
          label: string
          position: number
          team_id: string
        }
        Insert: {
          checklist_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_complete?: boolean
          is_required?: boolean
          label: string
          position?: number
          team_id: string
        }
        Update: {
          checklist_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_complete?: boolean
          is_required?: boolean
          label?: string
          position?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_checklist_items_checklist_fkey"
            columns: ["team_id", "checklist_id"]
            isOneToOne: false
            referencedRelation: "launch_checklists"
            referencedColumns: ["team_id", "id"]
          },
          {
            foreignKeyName: "launch_checklist_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      launch_checklist_template_items: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_required: boolean
          label: string
          position: number
          team_id: string
          template_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_required?: boolean
          label: string
          position?: number
          team_id: string
          template_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_required?: boolean
          label?: string
          position?: number
          team_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_checklist_template_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "launch_checklist_template_items_template_fkey"
            columns: ["team_id", "template_id"]
            isOneToOne: false
            referencedRelation: "launch_checklist_templates"
            referencedColumns: ["team_id", "id"]
          },
        ]
      }
      launch_checklist_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          name: string
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name: string
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_checklist_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "launch_checklist_templates_team_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_checklists: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          launch_id: string
          origin_template_id: string | null
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          launch_id: string
          origin_template_id?: string | null
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          launch_id?: string
          origin_template_id?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "launch_checklists_launch_fkey"
            columns: ["team_id", "launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["team_id", "id"]
          },
          {
            foreignKeyName: "launch_checklists_origin_template_fkey"
            columns: ["team_id", "origin_template_id"]
            isOneToOne: false
            referencedRelation: "launch_checklist_templates"
            referencedColumns: ["team_id", "id"]
          },
        ]
      }
      launch_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["launch_status"] | null
          kind: Database["public"]["Enums"]["launch_event_kind"]
          launch_id: string
          seq: number
          team_id: string
          to_status: Database["public"]["Enums"]["launch_status"] | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["launch_status"] | null
          kind: Database["public"]["Enums"]["launch_event_kind"]
          launch_id: string
          seq?: never
          team_id: string
          to_status?: Database["public"]["Enums"]["launch_status"] | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["launch_status"] | null
          kind?: Database["public"]["Enums"]["launch_event_kind"]
          launch_id?: string
          seq?: never
          team_id?: string
          to_status?: Database["public"]["Enums"]["launch_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "launch_events_actor_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "launch_events_launch_fkey"
            columns: ["team_id", "launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["team_id", "id"]
          },
        ]
      }
      launches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          prior_status: Database["public"]["Enums"]["launch_status"] | null
          status: Database["public"]["Enums"]["launch_status"]
          team_id: string
          url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          prior_status?: Database["public"]["Enums"]["launch_status"] | null
          status?: Database["public"]["Enums"]["launch_status"]
          team_id: string
          url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          prior_status?: Database["public"]["Enums"]["launch_status"] | null
          status?: Database["public"]["Enums"]["launch_status"]
          team_id?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "launches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "launches_team_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          user_id?: string
        }
        Relationships: []
      }
      team_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          team_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          team_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          team_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "team_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "team_invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      username_reservations: {
        Row: {
          claimed_at: string
          user_id: string
          username: string
        }
        Insert: {
          claimed_at?: string
          user_id: string
          username: string
        }
        Update: {
          claimed_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { token: string }; Returns: string }
      apply_checklist_template: {
        Args: { p_launch_id: string; p_template_id: string }
        Returns: string
      }
      claim_username: { Args: { p_username: string }; Returns: string }
      create_invitation: {
        Args: { invitee_email: string; target_team_id: string }
        Returns: string
      }
      create_launch: {
        Args: { p_launch_id: string; p_name: string; p_team_id: string }
        Returns: string
      }
      has_username: { Args: never; Returns: boolean }
      hash_invitation_token: { Args: { token: string }; Returns: string }
      is_team_member: { Args: { target_team_id: string }; Returns: boolean }
      is_team_owner: { Args: { target_team_id: string }; Returns: boolean }
      resolve_team_usernames: {
        Args: { p_team_id: string }
        Returns: {
          user_id: string
          username: string
        }[]
      }
      restore_launch: {
        Args: { p_launch_id: string }
        Returns: Database["public"]["Enums"]["launch_status"]
      }
      set_default_checklist_template: {
        Args: { p_team_id: string; p_template_id: string }
        Returns: string
      }
      transition_launch: {
        Args: {
          p_launch_id: string
          p_next: Database["public"]["Enums"]["launch_status"]
        }
        Returns: Database["public"]["Enums"]["launch_status"]
      }
    }
    Enums: {
      launch_event_kind: "created" | "transitioned" | "checklist_applied"
      launch_status: "preparing" | "active" | "archived" | "discarded" | "trash"
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
      launch_event_kind: ["created", "transitioned", "checklist_applied"],
      launch_status: ["preparing", "active", "archived", "discarded", "trash"],
    },
  },
} as const
