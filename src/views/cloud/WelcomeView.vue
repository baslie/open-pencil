<script setup lang="ts">
import { useRouter } from 'vue-router'

import { useCloudPortalMessages } from '@open-pencil/vue'

import { usePortal } from '@/app/cloud-portal/context'
import { openLocalEditor } from '@/app/cloud-portal/site'
import PortalPublicLayout from '@/components/cloud-portal/layout/PortalPublicLayout.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import { portalPublic } from '@/theme/cloud-portal/public'

/** The server's root for visitors who are not signed in: sign in, or use the editor without. */
const portal = usePortal()
const router = useRouter()
const messages = useCloudPortalMessages()
const ui = portalPublic()
</script>

<template>
  <PortalPublicLayout
    :host="portal.host"
    :heading="messages.welcomeTitle"
    :description="messages.welcomeDescription"
  >
    <div :class="ui.actions()">
      <AppButton
        size="lg"
        color="primary"
        variant="solid"
        class="w-full"
        @click="router.push({ name: 'sign-in' })"
      >
        {{ messages.signIn }}
      </AppButton>
      <AppButton size="lg" variant="outline" class="w-full" @click="openLocalEditor">
        {{ messages.useWithoutAccount }}
      </AppButton>
    </div>
    <template #aside>{{ messages.withoutAccountNote }}</template>
  </PortalPublicLayout>
</template>
