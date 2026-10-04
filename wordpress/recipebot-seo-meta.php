<?php
/**
 * Plugin Name: RecipeBot SEO Metadata Bridge
 * Description: Exposes Rank Math's three text fields to authenticated WordPress REST writes.
 * Version: 1.0.0
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
    if ( ! defined( 'RANK_MATH_VERSION' ) ) {
        return;
    }
    // REST metadata requires the post type to support custom fields.
    add_post_type_support( 'post', 'custom-fields' );
    foreach ( array( 'rank_math_title', 'rank_math_description', 'rank_math_focus_keyword' ) as $key ) {
        register_post_meta( 'post', $key, array(
            'type'              => 'string',
            'single'            => true,
            'show_in_rest'      => true,
            'sanitize_callback' => 'sanitize_text_field',
            'auth_callback'     => function ( $allowed, $meta_key, $post_id ) {
                return current_user_can( 'edit_post', $post_id );
            },
        ) );
    }
}, 20 );
