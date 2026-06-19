import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: () => import("@/components/layout/MainLayout.vue"),
    },
    {
      path: "/session/:sessionId",
      name: "session",
      component: () => import("@/components/layout/MainLayout.vue"),
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/",
    },
  ],
});

export default router;
