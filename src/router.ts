import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    {
      path: '/library/:id',
      name: 'library',
      component: () => import('./views/LibraryView.vue'),
      props: true,
    },
    {
      path: '/import',
      name: 'import',
      component: () => import('./views/ImportView.vue'),
    },
    {
      path: '/templates',
      name: 'templates',
      component: () => import('./views/TemplatesView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('./views/AboutView.vue'),
    },
    {
      path: '/oobe',
      name: 'oobe',
      component: () => import('./views/OobeView.vue'),
    },
  ],
})
