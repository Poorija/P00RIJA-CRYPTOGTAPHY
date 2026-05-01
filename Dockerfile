FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY certs /etc/nginx/certs/

COPY index.html /usr/share/nginx/html/
COPY manifest.webmanifest /usr/share/nginx/html/
COPY sw.js /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY vendor /usr/share/nginx/html/vendor
COPY Fonts /usr/share/nginx/html/Fonts
COPY assets /usr/share/nginx/html/assets

EXPOSE 8585

CMD ["nginx", "-g", "daemon off;"]