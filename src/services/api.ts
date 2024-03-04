import axios, { AxiosInstance, AxiosError } from 'axios';
import { AppError } from '@utils/AppError';
import { storageAuthTokenGet, storageAuthTokenSave } from '@storage/storageAuthToken';
type SignOut = () => void;

type PromiseType = {
  onSuccess: (token: string) => void;
  onFailure: (error: AxiosError) => void;
}

type APIInstanceProps = AxiosInstance & {
  registerInterceptorTokenManager: (signOut: SignOut) => () => void;
}

const api = axios.create({
  baseURL: 'http://192.168.0.216:3333'
}) as APIInstanceProps;

let failedQueue: Array<PromiseType> = [];
let isRefreshing = false;

api.registerInterceptorTokenManager = signOut => {
  const interceptorTokenManager = api.interceptors.response.use(response => response, async (requestError) => {
    if (requestError?.response?.status === 401) {
      const errorMessage = requestError.response.data?.message;
      if (errorMessage === 'token.expired' || errorMessage === 'token.invalid') {
        const { refresh_token } = await storageAuthTokenGet();
        if (!refresh_token) {
          signOut();
          return Promise.reject(requestError);
        }

        const originalRequestConfig = requestError.config;
        
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({
              onSuccess: (token) => {
                originalRequestConfig.headers = { 'Authorization' : `Bearer ${token}` };
                resolve(api(originalRequestConfig));
              },
              onFailure: (error) => {
                reject(error);
              },
            });
          });
        }

        isRefreshing = true;

        return new Promise(async (resolve, reject) => {
          try {
            const { data } = await api.post('/sessions/refresh-token', {
              refresh_token
            });

            await storageAuthTokenSave({ token: data.token, refresh_token: data.refresh_token });

            if (originalRequestConfig.data) {
              originalRequestConfig.data = JSON.parse(originalRequestConfig.data);
            }

            originalRequestConfig.headers = { 'Authorization' : `Bearer ${data.token}` };
            api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;

            failedQueue.forEach((request) => {
              request.onSuccess(data.token);
            });
            
            resolve(api(originalRequestConfig));
          } catch (error: any) {
            failedQueue.forEach((request) => {
              request.onFailure(error);
            });

            signOut();
            reject(error);
          } finally {
            isRefreshing = false;
            failedQueue = [];
          }
        });
      }

      signOut();
    }


    if (requestError.response && requestError.response?.data)
      return Promise.reject(new AppError(requestError.response.data.message));
    return Promise.reject(requestError);
  });

  return () => {
    api.interceptors.response.eject(interceptorTokenManager);
  }
}



export { api };